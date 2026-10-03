// The phone's reactions: a button in the header (next to the game menu) that opens a one-row tray of
// stickers in the header band, so it never covers the dock or an open decision. Tapping a sticker sends
// it to the TV. The phone mirrors the server's rate limit to show a cooldown ring on the button.
import {AnimatePresence, motion, useAnimationControls} from 'motion/react';
import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {REACTION_WINDOW_MS, ReactionLimiter, STICKERS, STICKER_LABEL} from '../../shared/reactions';
import type {StickerId} from '../../shared/reactions';
import {useNet} from '../net';
import {Sticker} from './Stickers';

/** One limiter per phone, shared by every header that shows the button. */
const limiter = new ReactionLimiter();
/** Set when the server refuses (e.g. a second phone for the same player also reacted). */
let serverCooldownUntil = 0;

function useCooldown(playerId: string): number {
  const [ms, setMs] = useState(0);
  useEffect(() => {
    const tick = () => setMs(Math.max(limiter.cooldown(playerId, Date.now()), serverCooldownUntil - Date.now(), 0));
    tick();
    const t = setInterval(tick, 200);
    return () => clearInterval(t);
  }, [playerId]);
  return ms;
}

const BTN = 40;

export function ReactionsButton({playerId}: {playerId: string}) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const cooldown = useCooldown(playerId);
  const shake = useAnimationControls();

  const toggle = () => {
    if (!open && cooldown > 0) {
      navigator.vibrate?.(8);
      void shake.start({x: [0, -4, 4, -3, 3, 0], transition: {duration: 0.35}});
      return;
    }
    if (btn.current) setRect(btn.current.getBoundingClientRect());
    setOpen((o) => !o);
  };

  const frac = Math.min(1, cooldown / REACTION_WINDOW_MS);
  return (
    <>
      <motion.button ref={btn} aria-label={cooldown > 0 ? `Reactions: ready in ${Math.ceil(cooldown / 1000)} seconds` : 'Send a reaction to the TV'}
        aria-expanded={open} onClick={toggle} animate={shake} whileTap={{scale: 0.9}} data-testid="react-open"
        style={{position: 'relative', zIndex: 42, width: BTN, height: BTN, flex: 'none', borderRadius: 12, display: 'grid', placeItems: 'center',
          background: open ? 'rgba(242,194,48,.18)' : 'rgba(255,255,255,.06)', boxShadow: open ? 'inset 0 0 0 1.5px var(--mc)' : 'none', color: 'var(--ice)'}}>
        <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden style={{opacity: cooldown > 0 ? 0.4 : 1, transition: 'opacity .2s'}}>
          <circle cx="11" cy="13" r="8" fill="none" stroke="currentColor" strokeWidth="1.9" />
          <circle cx="8.3" cy="11.3" r="1.2" fill="currentColor" />
          <circle cx="13.7" cy="11.3" r="1.2" fill="currentColor" />
          <path d="M7.6 15.2q3.4 3.2 6.8 0" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
          <path d="M20 1.8q.4 2.2 2.4 2.6q-2 .4-2.4 2.6q-.4-2.2-2.4-2.6q2-.4 2.4-2.6Z" fill="var(--mc)" />
        </svg>
        {cooldown > 0 && (
          <svg width={BTN} height={BTN} viewBox="0 0 40 40" aria-hidden style={{position: 'absolute', inset: 0, transform: 'rotate(-90deg)'}}>
            <circle cx="20" cy="20" r="18" fill="none" stroke="rgba(255,255,255,.12)" strokeWidth="2.5" />
            <circle cx="20" cy="20" r="18" fill="none" stroke="var(--mc)" strokeWidth="2.5" strokeLinecap="round"
              strokeDasharray={`${2 * Math.PI * 18}`} strokeDashoffset={`${2 * Math.PI * 18 * (1 - frac)}`} style={{transition: 'stroke-dashoffset .2s linear'}} />
          </svg>
        )}
      </motion.button>
      {createPortal(
        <AnimatePresence>
          {open && rect && <Tray key="tray" rect={rect} playerId={playerId} onClose={() => setOpen(false)} />}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}

function Tray({rect, playerId, onClose}: {rect: DOMRect; playerId: string; onClose: () => void}) {
  const react = useNet((s) => s.react);
  const [sent, setSent] = useState<StickerId | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [vw, setVw] = useState(() => window.innerWidth);
  useLayoutEffect(() => {
    const onResize = () => setVw(window.innerWidth);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('resize', onResize);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('resize', onResize); window.removeEventListener('keydown', onKey); };
  }, [onClose]);

  // One row in the header band: 8 stickers and a close button where the reactions button sits.
  const gap = 4;
  const pad = 5;
  // The tray spans the header band's width (covering the game menu button too while open) so it fits
  // eight thumb-sized stickers on a 360 px phone.
  const right = 8;
  const size = Math.max(30, Math.min(40, Math.floor((vw - right - 12 - BTN - gap - 2 * pad - 7 * gap) / 8)));
  const height = Math.max(BTN, size + 2 * pad);
  const top = rect.top + rect.height / 2 - height / 2;

  async function send(id: StickerId) {
    if (sent) return;
    const now = Date.now();
    const take = limiter.take(playerId, now);
    if (!take.ok) { setNote(`Ready in ${Math.ceil(take.retryInMs / 1000)} s`); navigator.vibrate?.(8); return; }
    setSent(id);
    navigator.vibrate?.(14);
    try {
      await react(playerId, id);
    } catch (e) {
      const m = /(\d+) s/.exec((e as Error).message);
      if (m) serverCooldownUntil = Date.now() + Number(m[1]) * 1000;
    }
    setTimeout(onClose, 280);
  }

  return (
    <>
      <div onPointerDown={onClose} style={{position: 'fixed', inset: 0, zIndex: 96}} />
      <motion.div role="menu" aria-label="Reactions"
        initial={{clipPath: `inset(0 0 0 calc(100% - ${BTN}px) round ${height / 2}px)`, opacity: 0.6}}
        animate={{clipPath: `inset(0 0 0 0 round ${height / 2}px)`, opacity: 1}}
        exit={{clipPath: `inset(0 0 0 calc(100% - ${BTN}px) round ${height / 2}px)`, opacity: 0, transition: {duration: 0.22}}}
        transition={{type: 'spring', stiffness: 420, damping: 34}}
        style={{position: 'fixed', top, right, zIndex: 97, height, display: 'flex', alignItems: 'center', gap, padding: `0 0 0 ${pad + 2}px`,
          borderRadius: height / 2, background: 'linear-gradient(180deg, rgba(74,34,24,.97), rgba(36,19,15,.97))',
          boxShadow: '0 0 0 1px var(--rim-strong), 0 12px 30px rgba(0,0,0,.5)', backdropFilter: 'blur(10px)'}}>
        {STICKERS.map((id, i) => (
          <motion.button key={id} role="menuitem" aria-label={STICKER_LABEL[id]} title={STICKER_LABEL[id]} data-sticker={id}
            onClick={() => send(id)}
            initial={{scale: 0.3, opacity: 0, y: 6}}
            animate={sent === id ? {scale: [1, 0.78, 1.35], y: [0, 2, -46], opacity: [1, 1, 0]} : {scale: sent ? 0.85 : 1, opacity: sent ? 0.35 : 1, y: 0}}
            transition={sent === id ? {duration: 0.42, times: [0, 0.3, 1], ease: 'easeOut'} : {type: 'spring', stiffness: 520, damping: 26, delay: (STICKERS.length - 1 - i) * 0.022}}
            whileTap={{scale: 0.84}}
            style={{width: size, height: size, flex: 'none', borderRadius: size / 2, padding: 0}}>
            <Sticker id={id} size={size} />
          </motion.button>
        ))}
        <button aria-label="Close reactions" onClick={onClose}
          style={{width: BTN, height: BTN, flex: 'none', borderRadius: 12, display: 'grid', placeItems: 'center', color: 'var(--ice-dim)'}}>
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
        </button>
        <AnimatePresence>
          {note && (
            <motion.div key="note" initial={{opacity: 0, y: -4}} animate={{opacity: 1, y: 0}} exit={{opacity: 0}}
              style={{position: 'absolute', right: 0, top: height + 6, padding: '4px 10px', borderRadius: 999, fontSize: 13, background: 'var(--dusk-3)', color: 'var(--mc)'}}>
              {note}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </>
  );
}
