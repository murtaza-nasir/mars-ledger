// What players do *to the table* from their phones: a card flicked up off a phone arrives on the TV
// from below, waits for the rules to accept it, is shown, and settles into its player's strip; a
// nudge rings the waiting player's strip. Works in both modes.
import {AnimatePresence, motion, useAnimationControls} from 'motion/react';
import {useEffect, useMemo, useRef, useState} from 'react';
import {findCard} from '../../../shared/cards';
import type {Flick, Nudge} from '../../../shared/social';
import {useNet} from '../../net';
import {TvCard} from '../TvCard';
import {PLAYER_HEX} from '../../ui/Icons';
import {director} from '../sound/director';
import {stripRect} from './flicks';
import {FLICK_SETTLE_MAX_MS, nextFlick} from './flickQueue';
import {useStage} from '../stage';

/** How long a flick may wait for the rules before it quietly goes back. */
const CONFIRM_TIMEOUT_MS = 9000;

export function TableLayer() {
  return <><FlickLayer /><NudgeRing /></>;
}

// ---- flicks ----------------------------------------------------------------------------------
function useConfirmed(): (f: Flick) => boolean {
  const state = useNet((s) => s.state);
  const view = useNet((s) => s.fullView);
  return useMemo(() => {
    const model = view?.role === 'spectator' ? view.model : null;
    return (f: Flick) => {
      // a player still answering the move's follow-up questions may take it back: the card waits until the move is done
      if (state?.mode === 'full' && model && view?.moving === f.color) return false;
      if (state?.mode === 'full' && model) return !!model.players.find((p) => p.color === f.color)?.tableau.some((c) => c.name === f.card);
      return !!state?.players.find((p) => p.id === f.playerId)?.played.some((c) => c.name === f.card);
    };
  }, [state, view]);
}

function FlickLayer() {
  const flicks = useNet((s) => s.flicks);
  const cancelled = useNet((s) => s.cancelledFlicks);
  const confirmedFn = useConfirmed();
  const movingColor = useNet((s) => s.fullView?.moving ?? null);
  const [done, setDone] = useState<Set<string>>(new Set());
  // Only flicks that arrived while this TV was watching, one at a time in arrival order; one that waited too long
  // behind the others is old news and is not shown (its card moment stood aside for it, flicks.ts).
  const mounted = useRef(Date.now());
  const [now, setNow] = useState(() => Date.now());
  const current = nextFlick(flicks, done, mounted.current, now, findCard);
  // a stale flick ahead of the others is passed over the next time the queue is looked at
  useEffect(() => {
    if (current) return;
    const waiting = flicks.some((f) => f.at >= mounted.current - 500 && !done.has(f.id));
    if (!waiting) return;
    const t = setTimeout(() => setNow(Date.now()), 1000);
    return () => clearTimeout(t);
  }, [current, flicks, done]);
  // test hook: the flick on screen
  (window as unknown as {__flickNow?: unknown}).__flickNow = current ? {id: current.id, card: current.card, color: current.color} : null;
  const busy = !!current;
  useEffect(() => { useStage.getState().set('flick', busy); }, [busy]);
  return (
    <div aria-hidden style={{position: 'fixed', inset: 0, zIndex: 70, pointerEvents: 'none', overflow: 'hidden'}}>
      <AnimatePresence>
        {current && (
          <FlickedCard key={current.id} flick={current} confirmed={confirmedFn(current)} cancelled={cancelled.includes(current.id)} moving={movingColor === current.color}
            onDone={() => { setDone((d) => new Set(d).add(current.id)); setNow(Date.now()); }} />
        )}
      </AnimatePresence>
    </div>
  );
}

type Phase = 'enter' | 'wait' | 'show' | 'settle' | 'cancel';

function FlickedCard({flick, confirmed, cancelled, moving, onDone}: {flick: Flick; confirmed: boolean; cancelled: boolean; moving?: boolean; onDone: () => void}) {
  const card = findCard(flick.card)!;
  const color = PLAYER_HEX[flick.color] ?? 'var(--mc)';
  const controls = useAnimationControls();
  const [phase, setPhase] = useState<Phase>('enter');
  const [landing, setLanding] = useState<DOMRect | null>(null);
  const started = useRef(Date.now());
  // Enter from the bottom edge under the player's strip, spinning slightly the way the phone threw it.
  const geo = useMemo(() => {
    const W = window.innerWidth, H = window.innerHeight;
    const r = stripRect(flick.color);
    const cx = r ? Math.min(W * 0.86, Math.max(W * 0.14, r.left + r.width / 2)) : W / 2;
    return {W, H, dx: cx - W / 2, dir: cx >= W / 2 ? 1 : -1};
  }, [flick.color]);

  useEffect(() => {
    let alive = true;
    (async () => {
      // start below the screen edge, big and blurred as if still travelling, then decelerate into place
      controls.set({x: geo.dx * 1.15, y: geo.H * 0.95, rotate: geo.dir * 18, scale: 1.5, opacity: 0, filter: 'blur(16px)'});
      await controls.start({x: 0, y: 0, rotate: 0, scale: 1, opacity: 1, filter: 'blur(0px)',
        transition: {duration: 1.15, ease: [0.22, 1, 0.36, 1], opacity: {duration: 0.3}, filter: {duration: 0.8}, rotate: {duration: 1.3, ease: [0.3, 1.4, 0.5, 1]}}});
      if (alive) setPhase((p) => (p === 'enter' ? 'wait' : p));
    })();
    return () => { alive = false; };
  }, [controls, geo]);

  // Wait for the rules: accepted → show; refused or too slow → go back down.
  useEffect(() => {
    if (phase !== 'wait') return;
    if (cancelled) { setPhase('cancel'); return; }
    if (confirmed) { setPhase('show'); return; }
    // the move's follow-up questions are open: wait for them however long they take (a back-out cancels the flick)
    if (moving) return;
    const t = setTimeout(() => setPhase('cancel'), Math.max(0, CONFIRM_TIMEOUT_MS - (Date.now() - started.current)));
    return () => clearTimeout(t);
  }, [phase, confirmed, cancelled, moving]);

  // The card leaves (onDone) once, when its last step has played. Only unmounting stops that: the steps below change the
  // phase, and a phase change must not cancel the step still running (it used to: the settle step set the phase, its own
  // cleanup then marked it dead, and onDone never came, so the layer kept this flick as its current one, invisible, until
  // twelve newer flicks pushed it out of the store, and then showed the next old flick as a new card was being played).
  const live = useRef(true);
  const finished = useRef(false);
  useEffect(() => () => { live.current = false; }, []);
  const finish = () => { if (live.current && !finished.current) { finished.current = true; onDone(); } };
  useEffect(() => {
    if (phase === 'show') {
      const t = setTimeout(() => setPhase('settle'), 2400);
      return () => clearTimeout(t);
    }
    if (phase === 'settle') {
      (async () => {
        const r = stripRect(flick.color);
        const W = window.innerWidth, H = window.innerHeight;
        const x = r ? r.left + r.width / 2 - W / 2 : 0;
        const y = r ? r.top + r.height / 2 - H * 0.46 : H * 0.6;
        await controls.start({x, y, scale: 0.14, rotate: geo.dir * 4, opacity: 0.0, filter: 'blur(2px)',
          transition: {duration: 0.7, ease: [0.55, 0, 0.8, 0.3], opacity: {duration: 0.7, ease: [0.9, 0, 1, 1]}}});
        if (!live.current) return;
        if (r) setLanding(r);
        director.cue('flickLand');
        setTimeout(finish, 900);
      })();
      // whatever happens to the animation, the card is gone well after it should have landed
      const t = setTimeout(finish, FLICK_SETTLE_MAX_MS);
      return () => clearTimeout(t);
    }
    if (phase === 'cancel') {
      director.cue('flickCancel');
      (async () => {
        await controls.start({y: window.innerHeight * 0.72, rotate: geo.dir * 7, scale: 0.92, opacity: 0, filter: 'blur(10px)',
          transition: {duration: 0.85, ease: [0.5, 0, 0.75, 0], delay: 0.35}});
        finish();
      })();
      const t = setTimeout(finish, FLICK_SETTLE_MAX_MS);
      return () => clearTimeout(t);
    }
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  const label = phase === 'cancel' ? 'Not played' : phase === 'enter' || phase === 'wait' ? 'is playing' : 'plays';
  return (
    <>
      {/* the room dims a little while the card has the floor */}
      <motion.div initial={{opacity: 0}} animate={{opacity: phase === 'settle' || phase === 'cancel' ? 0 : 1}} transition={{duration: phase === 'settle' ? 0.5 : 0.6}}
        style={{position: 'absolute', inset: 0, background: 'radial-gradient(50% 60% at 50% 46%, rgba(12,5,3,.55), rgba(12,5,3,.25) 70%, transparent)'}} />
      {/* a soft flare where the card arrives */}
      <motion.div initial={{opacity: 0, scale: 0.4}} animate={phase === 'enter' ? {opacity: [0, 0.7, 0], scale: [0.4, 1.3, 1.6]} : {opacity: 0}}
        transition={{duration: 1.1, delay: 0.55, ease: 'easeOut'}}
        style={{position: 'absolute', left: '50%', top: '46%', width: '40vw', height: '40vw', marginLeft: '-20vw', marginTop: '-20vw', borderRadius: '50%',
          background: `radial-gradient(circle, color-mix(in oklab, ${color} 55%, transparent), transparent 62%)`}} />
      <motion.div exit={{opacity: 0, transition: {duration: 0.3}}} data-flick-card={flick.card} data-moment-color={flick.color} data-flick-at={flick.at} data-flick-phase={phase}
        style={{position: 'absolute', left: '50%', top: '46%', width: '20vw', marginLeft: '-10vw', transform: 'translateY(-50%)'}}>
        <motion.div animate={controls} style={{transformOrigin: '50% 50%', willChange: 'transform, filter, opacity'}}>
          {/* hover gently while waiting for the rules */}
          <motion.div animate={phase === 'wait' ? {y: [0, -8, 0]} : {y: 0}} transition={phase === 'wait' ? {duration: 1.6, repeat: Infinity, ease: 'easeInOut'} : {duration: 0.3}}
            style={{opacity: phase === 'cancel' ? 0.7 : 1, transition: 'filter .4s, opacity .4s',
              // drop-shadows follow the card's own rounded shape (a box-shadow ring left dark corners)
              filter: phase === 'cancel' ? 'grayscale(.7) drop-shadow(0 1.6vw 2.6vw rgba(0,0,0,.6))'
                : `drop-shadow(0 0 0.18vw ${color}) drop-shadow(0 0 1.6vw color-mix(in oklab, ${color} 55%, transparent)) drop-shadow(0 1.6vw 2.6vw rgba(0,0,0,.6))`}}>
            <TvCard card={card} vw={20} />
          </motion.div>
        </motion.div>
      </motion.div>
      <AnimatePresence>
        {phase !== 'settle' && (
          <motion.div key="label" initial={{opacity: 0, y: 14}}
            animate={phase === 'cancel' ? {opacity: 0, y: 24, transition: {delay: 0.75, duration: 0.45}} : {opacity: 1, y: 0, transition: {delay: 0.45}}} exit={{opacity: 0, y: -10}}
            style={{position: 'absolute', left: 0, right: 0, top: 'calc(46% + 15.6vw)', display: 'flex', justifyContent: 'center'}}>
            <div style={{display: 'flex', alignItems: 'center', gap: '0.8vw', padding: '0.7vw 1.6vw', borderRadius: '99vw', background: 'rgba(12,5,3,.72)',
              backdropFilter: 'blur(10px)', boxShadow: `inset 0 0 0 0.12vw color-mix(in oklab, ${color} 60%, transparent)`, fontSize: '1.5vw', fontWeight: 700}}>
              <span style={{width: '0.9vw', height: '0.9vw', borderRadius: '0.25vw', background: color}} />
              <span style={{color}}>{flick.name}</span>
              <span style={{color: phase === 'cancel' ? 'var(--ember)' : 'var(--ice-dim)', fontWeight: 600}}>{label}</span>
              {(phase === 'enter' || phase === 'wait') && <Dots />}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {landing && <LandingRing rect={landing} color={color} />}
    </>
  );
}

function Dots() {
  return (
    <span style={{display: 'inline-flex', gap: '0.3vw'}}>
      {[0, 1, 2].map((i) => (
        <motion.span key={i} animate={{opacity: [0.2, 1, 0.2]}} transition={{duration: 1.1, repeat: Infinity, delay: i * 0.18}}
          style={{width: '0.45vw', height: '0.45vw', borderRadius: '50%', background: 'var(--ice-dim)'}} />
      ))}
    </span>
  );
}

function LandingRing({rect, color}: {rect: DOMRect; color: string}) {
  return (
    <motion.div initial={{opacity: 0.9, scale: 0.97}} animate={{opacity: 0, scale: 1.06}} transition={{duration: 0.9, ease: 'easeOut'}}
      style={{position: 'fixed', left: rect.left, top: rect.top, width: rect.width, height: rect.height, borderRadius: '1.1vw',
        boxShadow: `0 0 0 0.25vw ${color}, 0 0 3vw ${color}`}} />
  );
}

// ---- nudges ----------------------------------------------------------------------------------
function NudgeRing() {
  const nudge = useNet((s) => s.nudge);
  const [shown, setShown] = useState<Nudge | null>(null);
  const mounted = useRef(Date.now());
  useEffect(() => {
    if (!nudge || nudge.at < mounted.current - 500) return;
    setShown(nudge);
    const t = setTimeout(() => setShown((n) => (n?.id === nudge.id ? null : n)), 4200);
    return () => clearTimeout(t);
  }, [nudge]);
  const rect = shown ? stripRect(shown.toColor) : null;
  const to = shown ? PLAYER_HEX[shown.toColor] ?? 'var(--ice)' : '';
  const from = shown ? PLAYER_HEX[shown.fromColor] ?? 'var(--ice)' : '';
  return (
    <div aria-live="polite" style={{position: 'fixed', inset: 0, zIndex: 65, pointerEvents: 'none'}}>
      <AnimatePresence>
        {shown && (
          <motion.div key={shown.id} initial={{opacity: 0}} animate={{opacity: 1}} exit={{opacity: 0}} transition={{duration: 0.3}}>
            {rect && [0, 1, 2].map((i) => (
              <motion.div key={i} initial={{opacity: 0, scale: 1}} animate={{opacity: [0, 0.9, 0], scale: [1, 1.04, 1.09]}}
                transition={{duration: 1.2, delay: i * 0.55, ease: 'easeOut'}}
                style={{position: 'fixed', left: rect.left, top: rect.top, width: rect.width, height: rect.height, borderRadius: '1.1vw',
                  boxShadow: `0 0 0 0.22vw ${to}, 0 0 2.4vw ${to}`}} />
            ))}
            <motion.div initial={{opacity: 0, x: 30, scale: 0.9}} animate={{opacity: 1, x: 0, scale: 1}} exit={{opacity: 0, x: 20}}
              transition={{type: 'spring', stiffness: 260, damping: 20}}
              style={rect
                ? {position: 'fixed', top: rect.top + rect.height / 2, right: window.innerWidth - rect.left + window.innerWidth * 0.012, transform: 'translateY(-50%)'}
                : {position: 'fixed', top: '5vh', left: '50%', transform: 'translateX(-50%)'}}>
              <motion.div animate={{rotate: [0, -3, 3, -2, 2, 0]}} transition={{duration: 0.6, delay: 0.2}}
                style={{display: 'flex', alignItems: 'center', gap: '0.7vw', padding: '0.8vw 1.4vw', borderRadius: '99vw', whiteSpace: 'nowrap',
                  background: 'rgba(12,5,3,.82)', backdropFilter: 'blur(10px)', boxShadow: `inset 0 0 0 0.12vw ${to}`, fontSize: '1.35vw', fontWeight: 650}}>
                <svg aria-hidden width="1.7vw" height="1.7vw" viewBox="0 0 24 24" style={{width: '1.7vw', height: '1.7vw'}}>
                  <circle cx="12" cy="12" r="4" fill={to} />
                  <path d="M5 7.5a9 9 0 0 0 0 9M19 7.5a9 9 0 0 1 0 9" stroke={to} strokeWidth="2" fill="none" strokeLinecap="round" opacity=".7" />
                </svg>
                <span style={{color: from}}>{shown.fromName}</span>
                <span className="muted" style={{fontWeight: 550}}>is waiting on</span>
                <span style={{color: to}}>{shown.toName}</span>
              </motion.div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
