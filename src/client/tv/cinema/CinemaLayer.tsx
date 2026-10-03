// Plays the head of the cinema queue over the TV. It waits while the production show (or, in
// companion mode, a full-screen moment) has the screen, and never shows two cinematics at once.
import {AnimatePresence} from 'motion/react';
import {useEffect, useState} from 'react';
import type {GameHistory} from '../../../shared/history';
import {MilestoneCinematic} from './Milestone';
import {durationOf, hasGeneration, useCinema} from './queue';
import {Recap} from './Recap';
import {Reveal} from './Reveal';

/** True while a full-screen cinematic is playing (small beats do not count). */
export function useCinemaBusy(): boolean {
  return useCinema((s) => !!s.current && !(s.current.kind === 'milestone' && s.current.milestone.endsWith('bonus')));
}

/** Nothing playing and nothing waiting: the end-of-game story may take the screen. */
/** A full-screen cinematic is playing or waiting to start (the small bonus banners do not cover the board). */
export function useCinemaCovering(): boolean {
  const big = (c: {kind: string; milestone?: string}) => !(c.kind === 'milestone' && (c.milestone ?? '').endsWith('bonus'));
  return useCinema((s) => (!!s.current && big(s.current as {kind: string; milestone?: string})) || s.queue.some((c) => big(c as {kind: string; milestone?: string})));
}

export function useCinemaIdle(): boolean {
  return useCinema((s) => !s.current && !s.queue.length);
}

export function CinemaLayer({blocked, history}: {blocked: boolean; history: GameHistory | null}) {
  const current = useCinema((s) => s.current);
  const pump = useCinema((s) => s.pump);
  const done = useCinema((s) => s.done);
  const [t, setT] = useState(0);

  // The production show outranks everything but the story: a cinematic in progress gives way.
  useEffect(() => {
    if (blocked && current && current.kind !== 'story') done(current.id);
  }, [blocked, current, done]);

  useEffect(() => {
    pump(blocked);
    const i = setInterval(() => pump(blocked), 250);
    return () => clearInterval(i);
  }, [blocked, pump]);

  useEffect(() => {
    if (!current) return;
    // A recap waits up to 4 s for its generation's history, then gives up quietly.
    if (current.kind === 'recap' && !hasGeneration(history, current.generation)) {
      const t = setTimeout(() => done(current.id), 4000);
      return () => clearTimeout(t);
    }
    const d = durationOf(current);
    if (!isFinite(d)) return;
    const timer = setTimeout(() => done(current.id), d * 1000);
    setT(0);
    const tick = current.kind === 'reveal' ? setInterval(() => setT((Date.now() - current.startedAt) / 1000), 100) : null;
    return () => { clearTimeout(timer); if (tick) clearInterval(tick); };
  }, [current, history, done]);

  // Tap the TV to skip a cinematic (the story handles its own taps).
  useEffect(() => {
    if (!current || current.kind === 'story') return;
    const skip = () => useCinema.getState().skip();
    window.addEventListener('pointerdown', skip);
    return () => window.removeEventListener('pointerdown', skip);
  }, [current]);

  return (
    <AnimatePresence>
      {current?.kind === 'reveal' && <Reveal key={current.id} seats={current.seats} t={t} />}
      {current?.kind === 'recap' && history && hasGeneration(history, current.generation) && <Recap key={current.id} history={history} generation={current.generation} />}
      {current?.kind === 'milestone' && <MilestoneCinematic key={current.id} c={current} />}
    </AnimatePresence>
  );
}
