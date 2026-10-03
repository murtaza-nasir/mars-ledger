// A hand of cards you can riffle through: the centre card faces you, its neighbours fall back and
// turn away, and a sheen slides across the foil as you drag (or tilt, where the browser allows it).
import {AnimatePresence, animate, motion, useMotionValue, useMotionValueEvent, useTransform, type MotionValue} from 'motion/react';
import {useEffect, useLayoutEffect, useRef, useState, type ReactNode} from 'react';
import type {CardDef} from '../../../shared/types';
import {CardFace} from '../CardFace';
import {preloadArt} from './art';
import {useStableViewport} from '../viewport';
import {IS_IOS} from '../platform';
import {useViewerCovered} from './cover';
import {perfMark, useRenderCount} from '../../perf/recorder';

export type DeckItem = {
  key: string;
  card: CardDef;
  cost?: number;
  resources?: number;
  /** 'play' = you can play it now (gold), 'ready' = an unused action (blue pulse). */
  glow?: 'play' | 'ready';
  dim?: boolean;
  /** A small note under the card, e.g. "7 M€ short". */
  note?: ReactNode;
  /** A quiet hint pinned to the card's top edge, e.g. "6% O₂ · 1 step to go" (smart hints). */
  badge?: string;
  /** Works with something already in play (hand tools); the reason is shown when the card is lifted. */
  synergy?: boolean;
};

const SPRING = {type: 'spring' as const, stiffness: 260, damping: 30, mass: 0.9};
const SLOT_SPRING = {type: 'spring' as const, stiffness: 210, damping: 28, mass: 0.9};
// A played card flies off the top; a card a filter hides just sinks away; under the lifted view it just goes.
const EXIT = {
  exit: (style: 'play' | 'quiet' | 'still') => (style === 'still' ? {opacity: 0, transition: {duration: 0}} : style === 'quiet'
    ? {opacity: 0, y: 40, scale: 0.88, transition: {duration: 0.22, ease: [0.4, 0, 1, 1] as [number, number, number, number]}}
    : {opacity: 0, y: -700, rotate: -10, scale: 0.8, transition: {duration: 0.55, ease: [0.5, 0, 0.75, 0] as [number, number, number, number]}}),
};
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function DeckCarousel({items, onOpen, openKey, layoutPrefix = 'deck', label = 'cards', reserveBottom, exitStyle = 'play', resetKey, minWidth = 176}: {
  items: DeckItem[]; onOpen: (key: string) => void; openKey?: string | null; layoutPrefix?: string; label?: string;
  /** Pixels kept free below the deck's rail and note (e.g. a fixed dock); the card shrinks to fit above it. */
  reserveBottom?: number;
  /** How a card leaves: 'play' flies it off the top (it was played); 'quiet' fades it (a filter hid it). */
  exitStyle?: 'play' | 'quiet';
  /** When this changes (a new sort or filter), the deck glides back to its first card. */
  resetKey?: string;
  /** The narrowest the centre card may get before the page scrolls instead (lifting a card is for reading). */
  minWidth?: number;
}) {
  useRenderCount('Deck');
  const stage = useRef<HTMLDivElement>(null);
  // Under the open lifted view the deck holds still: cards that come into range appear in place, cards that leave
  // go at once and no pulse or dot animates (nothing animates behind the view).
  const still = useViewerCovered();
  const [w, setW] = useState(360);
  const [room, setRoom] = useState<number | null>(null);
  // Sized from the stable viewport (toolbar-showing height), never from window.innerHeight: on phones the
  // browser toolbar changes innerHeight while scrolling, which would resize every card and re-wrap its text.
  const view = useStableViewport();
  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const measure = () => {
      setW((x) => (Math.abs(x - el.clientWidth) > 2 ? el.clientWidth : x));
      if (reserveBottom !== undefined) {
        // height left for the card: viewport minus where the deck starts on an unscrolled page, the
        // stage's own margin (34), the rail and note (~52) and the reserved space
        const top = el.getBoundingClientRect().top + window.scrollY;
        const next = view.height - top - 34 - 52 - reserveBottom;
        setRoom((x) => (x === null || Math.abs(x - next) > 6 ? next : x));
      }
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => { ro.disconnect(); };
  }, [reserveBottom, view.height, view.width]);
  // never narrower than minWidth (176 px by default; the lifted view is for reading); below that the page
  // scrolls instead. 176 keeps a 360x740 phone's hand, note and hint line clear of each other above the dock;
  // the hand passes 156 because its tools row takes 34 px more above the deck.
  const byHeight = room === null ? Infinity : Math.max(minWidth, room * 63 / 88);
  const cw = 2 * Math.round(Math.min(w * 0.78, 340, byHeight) / 2);
  const ch = Math.round(cw * 88 / 63);
  const step = cw * 0.66;
  const pos = useMotionValue(0);
  const [idx, setIdx] = useState(0);
  const moved = useRef(false);
  const start = useRef(0);
  const n = items.length;

  useMotionValueEvent(pos, 'change', (v) => {
    const r = clamp(Math.round(v), 0, Math.max(0, n - 1));
    setIdx((x) => (x === r ? x : r));
    stage.current?.style.setProperty('--sx', String(clamp(0.5 - (v - Math.round(v)) * 1.1, 0, 1)));
  });
  // keep the index inside the hand when cards leave it
  useEffect(() => { if (pos.get() > n - 1) animate(pos, Math.max(0, n - 1), SPRING); }, [n, pos]);
  // a new order or filter starts from the first card
  const firstReset = useRef(true);
  useEffect(() => {
    if (firstReset.current) { firstReset.current = false; return; }
    animate(pos, 0, SPRING);
  }, [resetKey, pos]);
  useEffect(() => { preloadArt(items.slice(idx, idx + 3).map((i) => i.card.number)); }, [idx, items]);
  // The deck behind the lifted view follows it: moving to another card in the viewer centres that card here,
  // so putting it back lands it in the right place. The opaque view covers the deck, so it jumps there rather
  // than springing: no deck card moves (or repaints) behind the view while it is open.
  useEffect(() => {
    if (!openKey) return;
    const at = items.findIndex((it) => it.key === openKey);
    if (at >= 0 && at !== Math.round(pos.get())) pos.jump(at);
  }, [openKey, items, pos]);
  // Lifting a card decodes the art of the whole deck, so every card the viewer can reach paints whole at once.
  const lifted = !!openKey;
  useEffect(() => { if (lifted) preloadArt(items.map((i) => i.card.number)); }, [lifted, items]);

  // Tilt drives the sheen where the browser offers orientation without a permission prompt.
  useEffect(() => {
    const on = (e: DeviceOrientationEvent) => {
      if (e.gamma === null || e.beta === null) return;
      stage.current?.style.setProperty('--sx', String(clamp(0.5 + e.gamma / 60, 0, 1)));
      stage.current?.style.setProperty('--sy', String(clamp(0.2 + (e.beta - 45) / 90, 0, 1)));
    };
    window.addEventListener('deviceorientation', on);
    return () => window.removeEventListener('deviceorientation', on);
  }, []);

  const go = (t: number) => animate(pos, clamp(t, 0, Math.max(0, n - 1)), SPRING);

  if (!n) return null;
  return (
    <div>
      <motion.div ref={stage} role="listbox" aria-label={label} tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'ArrowRight') go(idx + 1); if (e.key === 'ArrowLeft') go(idx - 1); if (e.key === 'Enter') onOpen(items[idx].key); }}
        onPointerDown={() => { moved.current = false; }}
        onPointerMove={(e) => {
          const r = stage.current?.getBoundingClientRect();
          if (r) stage.current?.style.setProperty('--sy', String(clamp((e.clientY - r.top) / r.height, 0, 1)));
        }}
        onPanStart={() => { moved.current = true; start.current = pos.get(); perfMark('scroll', 'start'); }}
        onPan={(_, info) => {
          let v = start.current - info.offset.x / step;
          if (v < 0) v = v * 0.35; // rubber band at the ends
          if (v > n - 1) v = n - 1 + (v - (n - 1)) * 0.35;
          pos.set(v);
        }}
        onPanEnd={(_, info) => void go(Math.round(pos.get() - (info.velocity.x / step) * 0.28)).then(() => perfMark('scroll', 'end'))}
        style={{position: 'relative', height: ch + 34, margin: '0 -16px', touchAction: 'pan-y', outline: 'none', overflow: 'hidden',
          // its own stacking context, so the cards' z-order stays inside the deck (under sheets and the lifted view)
          isolation: 'isolate'}}>
        <AnimatePresence initial custom={still ? 'still' : exitStyle}>
          {items.map((it, i) => Math.abs(i - idx) <= 3 && (
            <DeckCard key={it.key} i={i} item={it} pos={pos} cw={cw} active={i === idx} hidden={openKey === it.key} still={still}
              // iPhones: no shared-layout morph into the lifted view (WebKit flickers on layout projection)
              layoutId={IS_IOS ? undefined : `${layoutPrefix}-${it.key}`}
              onClick={() => { if (moved.current) return; if (i === idx) { perfMark('open', 'start'); onOpen(it.key); } else go(i); }} />
          ))}
        </AnimatePresence>
      </motion.div>
      <Rail n={n} idx={idx} onPick={go} still={still} />
      <AnimatePresence mode="wait">
        {items[idx]?.note && (
          <motion.div key={items[idx].key} initial={still ? false : {opacity: 0, y: 4}} animate={{opacity: 1, y: 0}} exit={{opacity: 0, transition: still ? {duration: 0} : undefined}} style={{textAlign: 'center', marginTop: 6, fontSize: 14}}>
            {items[idx].note}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function DeckCard({i, item, pos, cw, active, hidden, still, layoutId, onClick}: {
  i: number; item: DeckItem; pos: MotionValue<number>; cw: number; active: boolean; hidden: boolean; still: boolean; layoutId?: string; onClick: () => void;
}) {
  // Each card springs from its old place to its new one when the hand is re-sorted or filtered.
  const slot = useMotionValue(i);
  useEffect(() => { animate(slot, i, SLOT_SPRING); }, [i, slot]);
  const o = useTransform(() => slot.get() - pos.get());
  const x = useTransform(o, (v) => Math.sign(v) * (Math.min(Math.abs(v), 1) * cw * 0.66 + Math.max(Math.abs(v) - 1, 0) * cw * 0.2));
  const y = useTransform(o, (v) => Math.min(Math.abs(v), 2.5) * 16);
  const scale = useTransform(o, (v) => 1 - Math.min(Math.abs(v), 2.5) * 0.11);
  // 2D only: WebKit (every iPhone browser) flickers on 3D-turned cards (rotateY + preserve-3d) and on
  // per-frame CSS filters while swiping. Neighbours lean and darken with transforms and an opacity layer.
  const rotateZ = useTransform(o, (v) => clamp(v * 3.4, -9, 9));
  const zIndex = useTransform(o, (v) => 100 - Math.round(Math.abs(v) * 10));
  const opacity = useTransform(o, (v) => clamp(1 - Math.max(Math.abs(v) - 1.8, 0) * 1.1, 0, 1));
  const shade = useTransform(o, (v) => Math.min(Math.abs(v), 2) * 0.24 + (item.dim ? 0.22 : 0));
  const artX = useTransform(o, (v) => -v * 22);
  const glow = item.glow === 'play' ? '0 0 0 2px rgba(242,194,48,.95), 0 0 34px rgba(242,194,48,.38)' : 'none';
  return (
    <motion.div
      initial={still ? false : {opacity: 0, y: 90, rotate: -12}} animate={{opacity: 1, y: 0, rotate: 0}}
      variants={EXIT} exit="exit"
      transition={{delay: Math.min(i, 6) * 0.05, type: 'spring', stiffness: 200, damping: 22}}
      style={{position: 'absolute', left: '50%', top: 8, width: cw, marginLeft: -cw / 2, zIndex}}>
      <motion.button type="button" onClick={onClick} aria-label={item.card.name} aria-selected={active} role="option" data-deck-card={item.card.name}
        style={{display: 'block', width: '100%', textAlign: 'left', x, y, scale, rotateZ, opacity,
          borderRadius: `${cw * 0.055}px`, boxShadow: active ? glow : 'none', visibility: hidden ? 'hidden' : 'visible'}}
        whileTap={active ? {scale: 0.98} : undefined}>
        {item.glow === 'ready' && active && (
          <motion.span aria-hidden="true" animate={still ? {opacity: 0.6} : {opacity: [0.35, 0.9, 0.35]}} transition={still ? {duration: 0} : {duration: 1.8, repeat: Infinity}}
            style={{position: 'absolute', inset: -3, borderRadius: `${cw * 0.06}px`, boxShadow: '0 0 0 2px #6FB8E8, 0 0 30px rgba(111,184,232,.5)', pointerEvents: 'none'}} />
        )}
        <CardFace card={item.card} cost={item.cost} resources={item.resources} artX={artX} layoutId={active && !hidden && layoutId ? layoutId : undefined} hideAutomation />
        <motion.span aria-hidden="true" style={{position: 'absolute', inset: 0, borderRadius: `${cw * 0.055}px`, background: '#0A0402', opacity: shade, pointerEvents: 'none'}} />
        {item.synergy && !hidden && (
          <motion.span data-synergy={item.card.name} aria-label="Works with your cards in play" initial={{scale: 0}} animate={{scale: 1}} transition={{delay: 0.2, type: 'spring', stiffness: 420, damping: 20}}
            style={{position: 'absolute', right: -7, top: '36%', width: Math.max(20, cw * 0.1), height: Math.max(20, cw * 0.1), borderRadius: 999, display: 'grid', placeItems: 'center',
              background: 'rgba(18,40,34,.96)', boxShadow: 'inset 0 0 0 1.5px rgba(127,209,185,.75), 0 3px 10px rgba(0,0,0,.45)', pointerEvents: 'none', zIndex: 5}}>
            <svg width="60%" height="60%" viewBox="0 0 16 16" aria-hidden="true"><circle cx="5.6" cy="8" r="3.6" fill="none" stroke="#7FD1B9" strokeWidth="1.8" />
              <circle cx="10.4" cy="8" r="3.6" fill="none" stroke="#7FD1B9" strokeWidth="1.8" /></svg>
          </motion.span>
        )}
        {item.badge && !hidden && (
          <motion.span data-hint-badge={item.card.name} initial={{opacity: 0, y: 4}} animate={{opacity: 1, y: 0}} transition={{delay: 0.25}}
            style={{position: 'absolute', left: 0, right: 0, marginInline: 'auto', width: 'fit-content', bottom: -12, display: 'flex', alignItems: 'center', gap: 5,
              maxWidth: '92%', padding: '3px 10px 3px 7px', borderRadius: 999, background: 'rgba(14,30,44,.95)', color: 'var(--ice)',
              boxShadow: 'inset 0 0 0 1px rgba(111,184,232,.45), 0 4px 12px rgba(0,0,0,.4)', fontSize: Math.max(11, cw * 0.042), fontWeight: 600,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', pointerEvents: 'none', zIndex: 5}}>
            <svg width="11" height="11" viewBox="0 0 16 16" aria-hidden="true" style={{flex: 'none'}}><path d="M8 1.5 9.4 6.6 14.5 8 9.4 9.4 8 14.5 6.6 9.4 1.5 8 6.6 6.6Z" fill="var(--tr)" /></svg>
            {item.badge}
          </motion.span>
        )}
      </motion.button>
    </motion.div>
  );
}

function Rail({n, idx, onPick, still}: {n: number; idx: number; onPick: (i: number) => void; still?: boolean}) {
  if (n < 2) return null;
  return (
    <div style={{display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 2}}>
      <div style={{display: 'flex', gap: 5}}>
        {n <= 14 ? Array.from({length: n}, (_, i) => (
          <button key={i} aria-label={`Card ${i + 1}`} onClick={() => onPick(i)} style={{padding: 4}}>
            <motion.span animate={{width: i === idx ? 18 : 6, opacity: i === idx ? 1 : 0.35}} transition={still ? {duration: 0} : undefined} style={{display: 'block', height: 6, borderRadius: 3, background: 'var(--ice)'}} />
          </button>
        )) : (
          <div style={{position: 'relative', width: 140, height: 4, borderRadius: 2, background: 'rgba(255,255,255,.14)'}}>
            <motion.div animate={{left: `${(idx / (n - 1)) * 100}%`}} transition={still ? {duration: 0} : undefined} style={{position: 'absolute', top: -3, width: 10, height: 10, marginLeft: -5, borderRadius: 5, background: 'var(--ice)'}} />
          </div>
        )}
      </div>
      <span className="num faint" style={{fontSize: 13}}>{idx + 1}/{n}</span>
    </div>
  );
}
