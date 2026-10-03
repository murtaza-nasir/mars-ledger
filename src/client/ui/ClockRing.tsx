// The turn clock's ring: calm in the player's colour, warm with a soft pulse in the last fifth,
// ember and full at zero ("Over time"), and dimmed with a pause mark while a show holds it.
import {AnimatePresence, motion, useReducedMotion} from 'motion/react';
import {useEffect, useRef} from 'react';
import {formatClock} from '../../shared/clock';
import {PLAYER_HEX} from '../../shared/game';
import type {LiveClock} from './useTurnClock';
import {useViewerCovered} from './deck/cover';

export function ringColor(live: LiveClock): string {
  const {reading, clock} = live;
  if (reading.overTime) return 'var(--ember)';
  if (reading.warm) return 'var(--heat)';
  return PLAYER_HEX[clock.color ?? ''] ?? 'var(--tr)';
}

/** A ring sized in any CSS unit; `stroke` is in viewBox units (the ring is drawn on a 40-unit box). */
export function ClockRing({live, size, stroke = 3.4, track = 'rgba(255,255,255,.12)', children}: {live: LiveClock; size: string; stroke?: number; track?: string; children?: React.ReactNode}) {
  const reduce = useReducedMotion();
  const {reading} = live;
  const r = 20 - stroke / 2 - 0.5;
  const c = 2 * Math.PI * r;
  const fill = reading.overTime ? 1 : reading.fraction;
  const color = ringColor(live);
  // the warm pulse rests while the lifted card view covers the phone
  const covered = useViewerCovered();
  const pulse = !reduce && (reading.warm || reading.overTime) && !reading.paused && !covered;
  return (
    <span style={{position: 'relative', display: 'inline-grid', placeItems: 'center', width: size, height: size, flex: 'none'}}>
      <motion.svg viewBox="0 0 40 40" width="100%" height="100%" aria-hidden style={{position: 'absolute', inset: 0, overflow: 'visible'}}
        animate={pulse ? {scale: [1, 1.07, 1]} : {scale: 1}} transition={pulse ? {duration: reading.overTime ? 1.8 : 1.2, repeat: Infinity, ease: 'easeInOut'} : {duration: 0.2}}>
        <circle cx="20" cy="20" r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <motion.circle cx="20" cy="20" r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
          transform="rotate(-90 20 20)" strokeDasharray={c} initial={false}
          animate={{strokeDashoffset: c * (1 - fill), opacity: reading.paused ? 0.45 : 1}}
          transition={{strokeDashoffset: {duration: covered ? 0 : 0.28, ease: 'linear'}, opacity: {duration: covered ? 0 : 0.3}}}
          style={{filter: reading.warm || reading.overTime ? `drop-shadow(0 0 2px ${color})` : undefined}} />
      </motion.svg>
      {children}
    </span>
  );
}

/** The active player's own clock on the phone: ring + time, "Over time" at zero, one gentle haptic. */
export function PhoneClock({live, compact}: {live: LiveClock; compact?: boolean}) {
  const {reading, clock} = live;
  const buzzed = useRef<string | null>(null);
  useEffect(() => {
    if (reading.overTime && buzzed.current !== clock.turnKey) {
      buzzed.current = clock.turnKey;
      navigator.vibrate?.([18, 80, 18]);
    }
  }, [reading.overTime, clock.turnKey]);
  const label = reading.overTime ? 'Over time' : formatClock(reading.remainingMs);
  return (
    <span data-testid="turn-clock" data-clock-state={reading.overTime ? 'over' : reading.warm ? 'warm' : reading.paused ? 'paused' : 'calm'}
      role="timer" aria-label={reading.overTime ? 'Turn clock: over time' : `Turn clock: ${label} left`}
      style={{display: 'inline-flex', alignItems: 'center', gap: 7, flex: 'none'}}>
      <ClockRing live={live} size={compact ? '22px' : '26px'} stroke={4.2}>
        {reading.paused && <PauseMark />}
      </ClockRing>
      <AnimatePresence mode="wait" initial={false}>
        <motion.span key={reading.overTime ? 'over' : 'time'} initial={{opacity: 0, y: 4}} animate={{opacity: 1, y: 0}} exit={{opacity: 0, y: -4}}
          transition={{duration: 0.2}} className={reading.overTime ? 'cond' : 'num'}
          style={{fontSize: reading.overTime ? (compact ? 14 : 15) : (compact ? 15 : 16), fontWeight: reading.overTime ? 700 : 750,
            color: reading.overTime ? 'var(--ember)' : reading.warm ? 'var(--heat)' : 'inherit', minWidth: reading.overTime ? undefined : '3.1ch', whiteSpace: 'nowrap',
            fontVariantNumeric: 'tabular-nums'}}>
          {label}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

function PauseMark() {
  return (
    <svg viewBox="0 0 10 10" width="42%" height="42%" aria-hidden style={{position: 'relative', opacity: 0.7}}>
      <rect x="2" y="1.5" width="2" height="7" rx="0.6" fill="currentColor" />
      <rect x="6" y="1.5" width="2" height="7" rx="0.6" fill="currentColor" />
    </svg>
  );
}
