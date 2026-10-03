// When the table leaves the map to chance, the TV reveals the draw as the game starts:
// three maps flicker past like a slot reel and the chosen one settles with its milestones and awards.
import {AnimatePresence, motion} from 'motion/react';
import {useEffect, useState} from 'react';
import {BOARDS, BOARD_NAMES} from '../../shared/board';
import type {BoardName} from '../../shared/board';
import {useNet} from '../net';
import {MiniMap} from '../ui/BoardPick';

export function BoardAnnounce() {
  const lastTick = useNet((s) => s.lastTick);
  const [shown, setShown] = useState<{seq: number; board: BoardName} | null>(null);
  const [spin, setSpin] = useState(0);

  useEffect(() => {
    const e = lastTick?.events.find((x) => x.kind === 'board');
    if (!lastTick || !e || e.kind !== 'board' || !e.random) return;
    setShown({seq: lastTick.seq, board: e.board});
    setSpin(0);
  }, [lastTick]);

  // The reel: a few quick flips through the maps, slowing, then the draw.
  useEffect(() => {
    if (!shown) return;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const steps = reduce ? 0 : 7;
    const timers: number[] = [];
    let t = 0;
    for (let i = 1; i <= steps; i++) { t += 90 + i * 45; timers.push(window.setTimeout(() => setSpin(i), t)); }
    timers.push(window.setTimeout(() => setShown(null), t + 4200));
    return () => timers.forEach(clearTimeout);
  }, [shown]);

  const reel = shown ? spinBoard(shown.board, spin) : null;
  const settled = shown && spin >= 7 || (shown && matchMedia('(prefers-reduced-motion: reduce)').matches);
  return (
    <AnimatePresence>
      {shown && reel && (
        <motion.div key={shown.seq} initial={{opacity: 0}} animate={{opacity: 1}} exit={{opacity: 0}} transition={{duration: 0.5}}
          style={{position: 'fixed', inset: 0, zIndex: 60, display: 'grid', placeItems: 'center', pointerEvents: 'none',
            background: 'radial-gradient(60% 60% at 50% 50%, rgba(36,19,15,.92), rgba(12,5,3,.96))'}}>
          <div style={{display: 'grid', justifyItems: 'center', gap: '1.6vw'}}>
            <div className="cond" style={{fontSize: '1.5vw', color: 'var(--ice-dim)', letterSpacing: '0.02em'}}>A random map</div>
            <motion.div key={reel} initial={{rotateY: -70, opacity: 0.2}} animate={{rotateY: 0, opacity: 1}} transition={{duration: settled ? 0.6 : 0.12}}
              style={{filter: settled ? 'drop-shadow(0 0 2.2vw rgba(242,194,48,.35))' : 'none'}}>
              <MiniMap board={reel} size={Math.round(window.innerWidth * 0.2)} />
            </motion.div>
            <motion.div key={`${reel}-t`} initial={{opacity: 0, y: 12}} animate={{opacity: 1, y: 0}}
              style={{fontSize: '5.4vw', lineHeight: 1, fontWeight: 850, fontVariationSettings: "'wdth' 118", color: settled ? 'var(--ice)' : 'var(--ice-faint)'}}>
              {BOARDS[reel].title}
            </motion.div>
            <AnimatePresence>
              {settled && (
                <motion.div initial={{opacity: 0, y: 10}} animate={{opacity: 1, y: 0}} transition={{delay: 0.3}}
                  style={{textAlign: 'center', fontSize: '1.3vw', maxWidth: '60vw', lineHeight: 1.5}}>
                  <div><span className="faint">Milestones </span>{BOARDS[shown.board].milestones.map((m) => m.name).join(' · ')}</div>
                  <div><span className="faint">Awards </span>{BOARDS[shown.board].awards.map((a) => a.name).join(' · ')}</div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Reel frames cycle through the maps and always stop on the drawn one. */
function spinBoard(final: BoardName, step: number): BoardName {
  if (step >= 7) return final;
  const start = (BOARD_NAMES.indexOf(final) + 1) % BOARD_NAMES.length;
  return BOARD_NAMES[(start + step) % BOARD_NAMES.length];
}
