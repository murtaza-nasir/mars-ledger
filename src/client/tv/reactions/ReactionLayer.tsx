// Stickers from phones, floating up from the sender's player strip. The same sticker from several
// players close together becomes one bigger sticker in the middle with a count and their names.
// Layered above the board and card moments, below cinematics and the production show (z 40+).
import {AnimatePresence, motion, useReducedMotion} from 'motion/react';
import {useEffect, useRef, useState} from 'react';
import {STICKERS, addReaction, inQuietWindow, isCombined, laneOf, liveBubbles} from '../../../shared/reactions';
import type {Bubble} from '../../../shared/reactions';
import {useNet} from '../../net';
import {PLAYER_HEX} from '../../ui/Icons';
import {Sticker} from '../../ui/Stickers';
import {useCinema} from '../cinema/queue';
import {director} from '../sound/director';
import {stripRect} from '../table/flicks';
import {useStage} from '../stage';

export function ReactionLayer() {
  const reactions = useNet((s) => s.reactions);
  const reduce = !!useReducedMotion();
  // Below cinematics (z 40+), except the end-of-game podium, which holds until the next game: that
  // is exactly when the table says "GG", so stickers show above it.
  const onPodium = useStage((s) => s.podium);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const ref = useRef<Bubble[]>([]);
  const seen = useRef(new Set<string>());
  const mounted = useRef(Date.now());

  useEffect(() => {
    let next = ref.current;
    for (const r of reactions) {
      if (seen.current.has(r.id)) continue;
      seen.current.add(r.id);
      if (r.at < mounted.current - 500) continue; // arrived before this TV was watching
      const now = Date.now();
      // Never in a cinematic's or the production show's first second.
      if (inQuietWindow([useCinema.getState().current?.startedAt, useNet.getState().production?.localStart, useStage.getState().storyStartedAt], now)) continue;
      const res = addReaction(next, r, now);
      next = res.bubbles;
      if (res.created) director.cue('reaction', STICKERS.indexOf(r.sticker) / 7);
    }
    if (next !== ref.current) { ref.current = next; setBubbles(next); }
  }, [reactions]);

  // Retire stickers whose time is up.
  useEffect(() => {
    const t = setInterval(() => {
      const live = liveBubbles(ref.current, Date.now());
      if (live.length !== ref.current.length) { ref.current = live; setBubbles(live); }
    }, 200);
    return () => clearInterval(t);
  }, []);

  return (
    <div aria-hidden data-reaction-layer={onPodium ? 'podium' : 'play'} style={{position: 'fixed', inset: 0, zIndex: onPodium ? 46 : 35, pointerEvents: 'none', overflow: 'hidden'}}>
      <AnimatePresence>
        {bubbles.map((b) => <Floating key={`${b.key}-${b.anchor}`} b={b} reduce={reduce} podium={onPodium} />)}
      </AnimatePresence>
    </div>
  );
}

/**
 * Where a sticker starts and how far it travels, in px. From a strip it appears at the strip's height
 * just left of it and drifts left over the board; stickers on screen together sit side by side (the
 * strips are close together, so height alone would overlap them). A combined burst sits over the board.
 */
function path(b: Bubble, size: number, label: number, podium: boolean): {x: number; y: number; fromX: number; dx: number; dy: number} {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const room = (y: number, want: number) => Math.max(0, Math.min(want, y - vh * 0.015));
  if (podium) {
    // The podium hides the strips: stickers gather in the free band beside the title instead (the
    // score rows grow downwards with more players), in one row from its middle outwards. Combined stickers take the
    // even places and single ones the odd places, so the two lanes never land on the same spot.
    const idx = laneOf(b.anchor) === 'center' ? b.slot * 2 : b.slot * 2 + 1;
    const step = idx === 0 ? 0 : Math.ceil(idx / 2) * (idx % 2 ? 1 : -1);
    const x = Math.min(Math.max(vw * 0.76 - size / 2 + step * vw * 0.11, vw * 0.52), vw * 0.98 - size);
    const y = vh * 0.13 - size / 2 + vh * 0.03;
    return {x, y, fromX: 0, dx: 0, dy: -room(y, vh * 0.03)};
  }
  if (b.anchor === 'center') {
    const x = vw * 0.42 - size / 2 + (b.slot % 3) * size * 1.2 - (b.slot >= 3 ? size * 0.6 : 0);
    const y = vh * 0.44 - size / 2 + (b.slot >= 3 ? size * 1.3 : 0);
    return {x, y, fromX: 0, dx: 0, dy: -room(y, vh * 0.05)};
  }
  const r = stripRect(b.anchor);
  const right = r ? r.left - vw * 0.008 : vw * 0.9;
  const x = right - size * (1 + b.slot * 1.15);
  // Keep the whole sticker and its name on screen, whatever strip it comes from.
  const cy = r ? r.top + r.height / 2 : vh * 0.72;
  const y = Math.min(Math.max(cy - size / 2, vh * 0.02), vh - size - label - vh * 0.1);
  return {x, y, fromX: size * 0.55, dx: -vw * 0.07, dy: -room(y, vh * 0.06)};
}

function Floating({b, reduce, podium}: {b: Bubble; reduce: boolean; podium: boolean}) {
  const vw = window.innerWidth;
  const combined = isCombined(b);
  const base = combined ? vw * 0.085 : vw * 0.058;
  const size = Math.round(base * (1 + Math.min(b.count - 1, 5) * (combined ? 0.05 : 0.03)));
  const [o] = useState(() => path(b, size, size * 0.3, podium));
  const ring = combined
    ? `conic-gradient(${b.senders.map((s, i) => `${PLAYER_HEX[s.color] ?? '#fff'} ${(i / b.senders.length) * 360}deg ${((i + 1) / b.senders.length) * 360}deg`).join(', ')})`
    : PLAYER_HEX[b.senders[0].color] ?? '#fff';

  return (
    <motion.div
      initial={reduce ? {opacity: 0} : {opacity: 0, x: o.fromX, y: 0, scale: 0.35}}
      animate={reduce ? {opacity: 1} : {opacity: 1, x: o.dx, y: o.dy, scale: 1}}
      exit={{opacity: 0, scale: reduce ? 1 : 0.9, transition: {duration: 0.5}}}
      transition={reduce ? {duration: 0.2} : {
        opacity: {duration: 0.25}, scale: {type: 'spring', stiffness: 380, damping: 16},
        x: {duration: 5.5, ease: 'easeOut'}, y: {duration: 5.5, ease: [0.2, 0.7, 0.4, 1]},
      }}
      data-reaction={b.sticker} data-count={b.count} data-combined={combined ? 'yes' : 'no'}
      style={{position: 'absolute', left: o.x, top: o.y, width: size, display: 'flex', flexDirection: 'column', alignItems: 'center'}}>
      {/* wobble while it drifts */}
      <motion.div animate={reduce ? {} : {rotate: [-6, 5, -4, 4, -6]}} transition={{duration: 2.6, repeat: Infinity, ease: 'easeInOut'}}
        style={{position: 'relative', width: size, height: size}}>
        {/* a pop each time another reaction joins */}
        <motion.div key={b.count} initial={b.count > 1 && !reduce ? {scale: 1.28} : false} animate={{scale: 1}} transition={{type: 'spring', stiffness: 500, damping: 14}}
          style={{width: size, height: size, borderRadius: '50%', padding: size * 0.055, background: ring,
            boxShadow: `0 ${size * 0.08}px ${size * 0.3}px rgba(0,0,0,.5)`}}>
          <div style={{width: '100%', height: '100%', borderRadius: '50%', background: '#1A0D0A', padding: size * 0.02}}>
            <Sticker id={b.sticker} size="100%" animated={!reduce} />
          </div>
        </motion.div>
        <AnimatePresence>
          {b.count > 1 && (
            <motion.div key="n" initial={{scale: 0, opacity: 0}} animate={{scale: 1, opacity: 1}} className="num"
              style={{position: 'absolute', right: -size * 0.12, top: -size * 0.06, padding: `${size * 0.03}px ${size * 0.09}px`, borderRadius: 999,
                fontSize: size * 0.2, background: 'var(--mc)', color: '#2A1A04', boxShadow: '0 2px 8px rgba(0,0,0,.4)'}}>
              ×{b.count}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
      <div className="cond" style={{marginTop: size * 0.08, whiteSpace: 'nowrap', fontSize: Math.max(12, size * (combined ? 0.15 : 0.19)), fontWeight: 650,
        padding: `${size * 0.02}px ${size * 0.08}px`, borderRadius: 999, background: 'rgba(12,5,3,.72)', textShadow: '0 1px 3px rgba(0,0,0,.6)'}}>
        {b.senders.map((s, i) => (
          <span key={s.playerId}>{i > 0 && <span style={{color: 'var(--ice-faint)'}}> · </span>}<span style={{color: PLAYER_HEX[s.color] ?? 'var(--ice)'}}>{s.name}</span></span>
        ))}
      </div>
    </motion.div>
  );
}
