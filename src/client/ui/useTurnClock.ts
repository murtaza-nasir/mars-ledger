// The turn clock as a live reading: re-renders a few times a second while a turn is running.
import {useEffect, useState} from 'react';
import {readClock} from '../../shared/clock';
import type {ClockReading, TurnClock} from '../../shared/clock';
import {useNet} from '../net';
import {useViewerCovered} from './deck/cover';

export type LiveClock = {clock: TurnClock; reading: ClockReading};

/** The running clock, or null when the clock is off or nobody is on a turn. */
export function useTurnClock(): LiveClock | null {
  const tc = useNet((s) => s.turnClock);
  const running = !!tc?.clock.playerId;
  const [, tick] = useState(0);
  // rests while the lifted card view covers the phone (it reads the right time again when the view closes)
  const covered = useViewerCovered();
  useEffect(() => {
    if (!running || covered) return;
    const t = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(t);
  }, [running, covered]);
  if (!tc || !tc.clock.playerId) return null;
  return {clock: tc.clock, reading: readClock(tc.clock, Date.now() + tc.offset)};
}
