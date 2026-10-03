// A friendly nudge for a player who has been deciding a while, and the moment it arrives on their phone.
import {AnimatePresence, motion} from 'motion/react';
import {useEffect, useRef, useState} from 'react';
import {NUDGE_AFTER_MS, NUDGE_COOLDOWN_MS} from '../../shared/social';
import {useNet} from '../net';
import {PLAYER_HEX} from '../ui/Icons';
import {useViewerCovered} from '../ui/deck/cover';

/** When `key` last changed (a new active player or any move resets the clock). */
export function useSince(key: string): number {
  const [since, setSince] = useState(() => Date.now());
  const last = useRef(key);
  useEffect(() => {
    if (last.current !== key) { last.current = key; setSince(Date.now()); }
  }, [key]);
  return since;
}

/** Re-render every `ms` while `on`, so time-based affordances appear on their own. */
function useTick(on: boolean, ms = 1000) {
  const [, set] = useState(0);
  const covered = useViewerCovered();
  useEffect(() => {
    if (!on || covered) return;
    const t = setInterval(() => set((n) => n + 1), ms);
    return () => clearInterval(t);
  }, [on, ms, covered]);
}

let lastSent = 0; // per device, like the server's per-sender cooldown

/**
 * "Nudge Vera" — appears once the other player has been deciding for NUDGE_AFTER_MS.
 * Hidden for yourself and while the cooldown runs.
 */
export function NudgeButton({from, to, toName, toColor, since, overTime}: {from: string; to: string | null | undefined; toName: string; toColor: string; since: number; overTime?: boolean}) {
  const sendNudge = useNet((s) => s.sendNudge);
  const [sentAt, setSentAt] = useState(lastSent);
  const eligible = !!to && to !== from;
  useTick(eligible);
  if (!eligible) return null;
  const now = Date.now();
  // The turn clock running out unlocks the nudge at once; otherwise after NUDGE_AFTER_MS of deciding.
  const ready = !!overTime || now - since >= NUDGE_AFTER_MS;
  const cooling = now - sentAt < NUDGE_COOLDOWN_MS;
  return (
    <AnimatePresence>
      {ready && (
        <motion.button key="nudge" data-testid="nudge" disabled={cooling}
          initial={{opacity: 0, scale: 0.7, x: 10}} animate={{opacity: 1, scale: 1, x: 0}} exit={{opacity: 0, scale: 0.8}}
          transition={{type: 'spring', stiffness: 380, damping: 22}} whileTap={{scale: 0.92}}
          onClick={() => { sendNudge(from, to!); lastSent = Date.now(); setSentAt(lastSent); navigator.vibrate?.(12); }}
          aria-label={cooling ? `Nudged ${toName}` : `Nudge ${toName}`}
          style={{display: 'inline-flex', alignItems: 'center', gap: 7, minHeight: 40, padding: '0 14px', borderRadius: 999, flex: 'none',
            fontSize: 14.5, fontWeight: 650, color: cooling ? 'var(--ice-faint)' : 'var(--ice)',
            background: cooling ? 'rgba(255,255,255,.04)' : `color-mix(in oklab, ${PLAYER_HEX[toColor] ?? '#888'} 22%, rgba(255,255,255,.04))`,
            boxShadow: `inset 0 0 0 1.5px ${cooling ? 'var(--rim)' : `color-mix(in oklab, ${PLAYER_HEX[toColor] ?? '#888'} 70%, transparent)`}`}}>
          <motion.svg width="16" height="16" viewBox="0 0 24 24" aria-hidden animate={cooling ? {} : {rotate: [0, -14, 12, -8, 0]}}
            transition={{duration: 0.9, repeat: Infinity, repeatDelay: 2.4}}>
            <circle cx="12" cy="12" r="3.6" fill="currentColor" />
            <path d="M5.5 7.5a8.5 8.5 0 0 0 0 9M18.5 7.5a8.5 8.5 0 0 1 0 9" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
          </motion.svg>
          {cooling ? 'Nudged' : 'Nudge'}
        </motion.button>
      )}
    </AnimatePresence>
  );
}

/** The moment a nudge lands on its target: the board wobbles, a bubble slides in, a haptic pattern. */
export function NudgeReceiver({me}: {me: string}) {
  const nudge = useNet((s) => s.nudge);
  const [shown, setShown] = useState<typeof nudge>(null);
  const mounted = useRef(Date.now());
  useEffect(() => {
    if (!nudge || nudge.to !== me || nudge.at < mounted.current - 500) return;
    setShown(nudge);
    navigator.vibrate?.([35, 60, 35, 60, 90]);
    const root = document.getElementById('root');
    root?.animate([
      {transform: 'translateX(0) rotate(0deg)'}, {transform: 'translateX(-9px) rotate(-0.8deg)'}, {transform: 'translateX(8px) rotate(0.7deg)'},
      {transform: 'translateX(-5px) rotate(-0.4deg)'}, {transform: 'translateX(3px) rotate(0.2deg)'}, {transform: 'translateX(0) rotate(0deg)'},
    ], {duration: 650, easing: 'cubic-bezier(.36,.07,.19,.97)'});
    const t = setTimeout(() => setShown((n) => (n?.id === nudge.id ? null : n)), 3600);
    return () => clearTimeout(t);
  }, [nudge, me]);
  const color = shown ? PLAYER_HEX[shown.fromColor] ?? 'var(--mc)' : '';
  return (
    <AnimatePresence>
      {shown && (
        <motion.div key={shown.id} role="status" aria-live="assertive" onClick={() => setShown(null)}
          initial={{y: -120, opacity: 0, scale: 0.9}} animate={{y: 0, opacity: 1, scale: 1}} exit={{y: -80, opacity: 0}}
          transition={{type: 'spring', stiffness: 300, damping: 22}}
          style={{position: 'fixed', top: 'calc(10px + env(safe-area-inset-top))', left: 14, right: 14, zIndex: 95, display: 'flex', justifyContent: 'center'}}>
          <div style={{display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderRadius: 20, maxWidth: 420, width: '100%',
            background: 'linear-gradient(160deg, var(--dusk-3), var(--dusk-2))', boxShadow: `0 0 0 2px ${color}, 0 18px 40px rgba(0,0,0,.5)`}}>
            <motion.div animate={{scale: [1, 1.25, 1], rotate: [0, -12, 10, 0]}} transition={{duration: 0.7, repeat: 2}}
              style={{width: 38, height: 38, borderRadius: 19, flex: 'none', display: 'grid', placeItems: 'center', background: color, color: '#1A0D0A'}}>
              <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden>
                <circle cx="12" cy="12" r="3.6" fill="currentColor" />
                <path d="M5.5 7.5a8.5 8.5 0 0 0 0 9M18.5 7.5a8.5 8.5 0 0 1 0 9" stroke="currentColor" strokeWidth="2.2" fill="none" strokeLinecap="round" />
              </svg>
            </motion.div>
            <div style={{flex: 1, minWidth: 0}}>
              <div style={{fontWeight: 750, fontSize: 17, fontVariationSettings: "'wdth' 88"}}><span style={{color}}>{shown.fromName}</span> is waiting on you</div>
              <div className="muted" style={{fontSize: 14}}>Your move is ready when you are.</div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
