// The turn clock on the TV: a thin arc around the active player's portrait (full games) or beside their
// name (companion), draining as the turn goes on, warm in the last fifth, ember once over time.
import {AnimatePresence, motion} from 'motion/react';
import {ClockRing} from '../ui/ClockRing';
import {useTurnClock} from '../ui/useTurnClock';
import type {LiveClock} from '../ui/useTurnClock';

/** The live clock if it is this player's turn. */
export function useStripClock(color: string): LiveClock | null {
  const live = useTurnClock();
  return live && live.clock.color === color ? live : null;
}

/** Wraps a portrait: the arc sits just outside it. `sizeVw` is the portrait's diameter. */
export function PortraitClock({color, sizeVw, children}: {color: string; sizeVw: number; children: React.ReactNode}) {
  const live = useStripClock(color);
  return (
    <span style={{position: 'relative', display: 'inline-grid', placeItems: 'center', flexShrink: 0, minWidth: live ? `${sizeVw}vw` : undefined, minHeight: live ? `${sizeVw}vw` : undefined}}>
      {children}
      <AnimatePresence>
        {live && (
          <motion.span key={live.clock.turnKey} data-testid="tv-turn-clock" data-clock-state={live.reading.overTime ? 'over' : live.reading.warm ? 'warm' : 'calm'}
            initial={{opacity: 0, scale: 0.8}} animate={{opacity: 1, scale: 1}} exit={{opacity: 0, scale: 1.15}} transition={{type: 'spring', stiffness: 220, damping: 20}}
            style={{position: 'absolute', left: '50%', top: '50%', width: `${sizeVw + 0.9}vw`, height: `${sizeVw + 0.9}vw`, marginLeft: `-${(sizeVw + 0.9) / 2}vw`,
              marginTop: `-${(sizeVw + 0.9) / 2}vw`, pointerEvents: 'none'}}>
            <ClockRing live={live} size="100%" stroke={2.2} track="rgba(255,255,255,.08)" />
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

/** A small ring for strips without a portrait (companion TV). */
export function InlineClock({color, sizeVw}: {color: string; sizeVw: number}) {
  const live = useStripClock(color);
  return (
    <AnimatePresence>
      {live && (
        <motion.span key={live.clock.turnKey} data-testid="tv-turn-clock" data-clock-state={live.reading.overTime ? 'over' : live.reading.warm ? 'warm' : 'calm'}
          initial={{opacity: 0, scale: 0.6, width: 0}} animate={{opacity: 1, scale: 1, width: `${sizeVw}vw`}} exit={{opacity: 0, scale: 0.6, width: 0}}
          transition={{type: 'spring', stiffness: 260, damping: 22}} style={{display: 'inline-grid', placeItems: 'center', height: `${sizeVw}vw`, flexShrink: 0}}>
          <ClockRing live={live} size={`${sizeVw}vw`} stroke={4.4} />
        </motion.span>
      )}
    </AnimatePresence>
  );
}

/** "over time", quietly, for the strip's second line. */
export function OverTimeNote({color, sizeVw}: {color: string; sizeVw: number}) {
  const live = useStripClock(color);
  return (
    <AnimatePresence>
      {live?.reading.overTime && (
        <motion.span key="over" initial={{opacity: 0}} animate={{opacity: 1}} exit={{opacity: 0}} className="cond"
          style={{color: 'var(--ember)', fontWeight: 650, fontSize: `${sizeVw}vw`}}> · over time</motion.span>
      )}
    </AnimatePresence>
  );
}
