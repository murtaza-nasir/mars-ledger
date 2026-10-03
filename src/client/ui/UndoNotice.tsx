// An undo is seen everywhere at once. The TV and every phone show "<name> undid their last move" for a few seconds;
// a phone whose answer was refused because the game changed shows the server's explanation the same way.
import {AnimatePresence, motion} from 'motion/react';
import {useEffect, useState} from 'react';
import {PLAYER_HEX} from './Icons';
import {useNet} from '../net';
import {undoNoticeText} from '../../shared/sync';

export const NOTICE_MS = 4500;

/**
 * The text of an undo notice for this device: "You undid…" on the undoer's phone, "<name> undid…" elsewhere. An undo
 * through bot moves says how many it took back: "Ada took back their move and 2 bot moves".
 */
export const undoText = undoNoticeText;

/** True for `ms` after `at` (re-renders once when it runs out). */
function useFor(at: number | null | undefined, ms: number): boolean {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!at) return;
    const left = at + ms - Date.now();
    if (left <= 0) return;
    const t = setTimeout(() => tick((n) => n + 1), left + 20);
    return () => clearTimeout(t);
  }, [at, ms]);
  return !!at && Date.now() < at + ms;
}

/** One line at the top of the screen. `line` adds a second, smaller line (phones: what happened to an open question). */
export function TableNotice({id, text, line, color, tv, testId}: {id: string | null; text: string; line?: string | null; color?: string | null; tv?: boolean; testId: string}) {
  return (
    <AnimatePresence>
      {id && (
        <motion.div key={id} role="status" aria-live="polite" data-testid={testId}
          initial={{opacity: 0, y: -14}} animate={{opacity: 1, y: 0}} exit={{opacity: 0, y: -10}} transition={{type: 'spring', stiffness: 380, damping: 30}}
          style={tv
            ? {position: 'absolute', left: '50%', top: '3vh', x: '-50%', zIndex: 65, display: 'flex', alignItems: 'center', gap: '0.8vw',
              padding: '1.2vh 1.6vw', borderRadius: 999, background: 'rgba(20,9,6,.94)', pointerEvents: 'none',
              boxShadow: `inset 0 0 0 0.12vw ${color ?? 'var(--rim-strong)'}, 0 1.4vw 3vw rgba(0,0,0,.5)`, whiteSpace: 'nowrap'}
            : {position: 'fixed', left: 12, right: 12, top: 'calc(10px + env(safe-area-inset-top))', zIndex: 90, padding: '11px 14px', borderRadius: 16,
              background: 'rgba(30,14,10,.96)', pointerEvents: 'none',
              boxShadow: `inset 0 0 0 1.5px ${color ?? 'var(--rim-strong)'}, 0 8px 24px rgba(0,0,0,.45)`}}>
          <svg viewBox="0 0 24 24" width={tv ? undefined : 20} height={tv ? undefined : 20} aria-hidden="true"
            style={tv ? {width: '2vw', height: '2vw', flex: 'none'} : {float: 'left', marginRight: 10, marginTop: 1}}>
            <path d="M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3" fill="none" stroke={color ?? 'var(--ice)'} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div>
            <div style={{fontWeight: 750, fontSize: tv ? '1.7vw' : 16.5, color: 'var(--ice)'}}>{text}</div>
            {line && <div style={{marginTop: tv ? '0.3vh' : 2, fontSize: tv ? '1.15vw' : 14, color: 'var(--ice-dim)'}}>{line}</div>}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** The table's latest undo, shown for a few seconds after it arrives. */
export function UndoNotice({tv, meId, line}: {tv?: boolean; meId?: string | null; line?: string | null}) {
  const n = useNet((s) => s.undoNotice);
  const showing = useFor(n?.receivedAt, NOTICE_MS);
  return (
    <TableNotice id={showing && n ? n.id : null} text={n ? undoText(n, meId) : ''} line={line}
      color={n?.color ? PLAYER_HEX[n.color as keyof typeof PLAYER_HEX] : null} tv={tv} testId="undo-notice" />
  );
}

/** A notice that shows for a few seconds after `at` (phones: an answer refused because the game changed). */
export function TimedNotice({at, text, testId}: {at: number | null; text: string; testId: string}) {
  const showing = useFor(at, NOTICE_MS);
  return <TableNotice id={showing && at ? `${testId}-${at}` : null} text={text} testId={testId} color="var(--ember)" />;
}
