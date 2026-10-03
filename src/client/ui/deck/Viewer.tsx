// A card lifted out of the hand (or a table pile) to full size. Swipe it up (or press Play) and it flies off
// the top of the phone toward the table; swipe it down or tap outside to put it back; swipe sideways (or use
// the arrows) to move to the previous or next card of the same deck without leaving the view.
import {AnimatePresence, animate, motion, useAnimationControls, useIsPresent, useMotionValue} from 'motion/react';
import {useEffect, useLayoutEffect, useRef, useState, type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import type {CardDef} from '../../../shared/types';
import {CardFace} from '../CardFace';
import {IS_IOS} from '../platform';
import {useStableViewport} from '../viewport';
import {preloadArt} from './art';
import {setViewerCovered} from './cover';
import {useCardHints} from './hintWorld';
import {perfMark, useRenderCount} from '../../perf/recorder';

export type Fly = (send: () => Promise<string | null>) => Promise<void>;

/** Where the lifted card sits in its deck, and how to move along it. */
export type ViewerNav = {index: number; count: number; go: (delta: -1 | 1) => void;
  /** The neighbouring card, so it is already laid out (and its art decoded) before a swipe reaches it. */
  peek?: (delta: -1 | 1) => {card: CardDef; cost?: number; resources?: number; status?: CardStatus} | null};

/** A table card's action: ready to use, or used this generation. */
export type CardStatus = 'ready' | 'used';

export function CardViewer({card, cost, resources, status, layoutId, onClose, canPlay, swipePlay, children, note, backLabel, nav}: {
  card: CardDef | null;
  cost?: number;
  resources?: number;
  status?: CardStatus;
  layoutId?: string;
  onClose: () => void;
  /** Whether swiping up plays the card. */
  canPlay?: boolean;
  /** Plays with the current payment; resolves to an error message or null. */
  swipePlay?: () => Promise<string | null>;
  /** Controls under the card (payment, notes). Receives fly() so a Play button can launch the card. */
  children?: (fly: Fly) => ReactNode;
  note?: ReactNode;
  backLabel?: string;
  /** Previous/next card of the same deck (hand or pile); omitted for a single card. */
  nav?: ViewerNav;
}) {
  if (typeof document === 'undefined') return null;
  // In a portal on <body>: no transformed, faded or clipped ancestor (a tab panel's fade, the deck) can turn the
  // fixed viewer into a nested layer, and the page under it can be hidden without hiding the viewer.
  return createPortal(
    <AnimatePresence>
      {/* One viewer for the whole visit: moving between cards swaps the card, not the backdrop. */}
      {card && <Lifted key="viewer" card={card} cost={cost} resources={resources} status={status} layoutId={IS_IOS ? undefined : layoutId} onClose={onClose}
        canPlay={canPlay} swipePlay={swipePlay} note={note} backLabel={backLabel} nav={nav}>{children}</Lifted>}
    </AnimatePresence>,
    document.body,
  );
}

// Cards beside the focused one sit in a strip: previous, current, next, each keyed by name and placed at its
// position in the deck, so a swipe moves already-mounted cards with one translate. Nothing remounts, rotates or
// fades mid-swipe; in WebKit those re-rasterised the card text and re-decoded its art every move, which flickered
// on iPhones. The strip is one composited layer for the viewer's whole life: will-change is set once and its
// transform is always a translate3d (never 'none'), so WebKit never drops the layer at rest and re-promotes it on
// the next swipe. Moving to a card leaves the strip where the slide ended (the strip offset is the card's place in
// the deck), so no reset frame is needed after a move.
const GAP = 28;
const stripTransform = ({x, y}: {x?: string | number; y?: string | number}) => `translate3d(${x ?? '0px'}, ${y ?? '0px'}, 0)`;

function Lifted({card, cost, resources, status, layoutId, onClose, canPlay, swipePlay, children, note, backLabel = 'Put it back', nav}: {
  card: CardDef; cost?: number; resources?: number; status?: CardStatus; layoutId?: string; onClose: () => void; canPlay?: boolean;
  swipePlay?: () => Promise<string | null>; children?: (fly: Fly) => ReactNode; note?: ReactNode; backLabel?: string; nav?: ViewerNav;
}) {
  useRenderCount('Viewer');
  const controls = useAnimationControls();
  const [error, setError] = useState<string | null>(null);
  // A fixed layout width from the stable viewport: the toolbar showing or hiding never resizes the card
  // (that re-wrapped its text on iPhones). Even pixels keep WebKit's text rasterisation steady.
  const view = useStableViewport();
  const cardW = Math.max(250, 2 * Math.floor(Math.min(view.width * 0.88, 400, (view.height - 250) * 63 / 88) / 2));
  const [flying, setFlying] = useState(false);
  // The first card keeps its lift-from-the-deck shared layout (not on iPhones); cards reached by swiping slide in.
  const firstName = useRef(card.name);
  const step = cardW + GAP;
  const index = nav?.index ?? 0;
  const base = -index * step;
  const x = useMotionValue(base);
  const sliding = useRef(false);
  const cardH = Math.round(cardW * 88 / 63);
  const prev = nav?.peek?.(-1) ?? null;
  const next = nav?.peek?.(1) ?? null;
  // relevant counts from the live game, for the card in view and its neighbours (laid out before they slide in)
  const hints = {[-1]: useCardHints(prev?.card), 0: useCardHints(card), 1: useCardHints(next?.card)} as Record<number, ReturnType<typeof useCardHints>>;
  // The deck changed under the view (a card played, a new order): put the strip on the card in view.
  useLayoutEffect(() => {
    if (!sliding.current && x.get() !== base) x.jump(base);
  }, [base, x]);
  useEffect(() => { preloadArt([prev?.card.number, next?.card.number]); }, [prev?.card.number, next?.card.number]);
  // While the view is open and opaque, the page under it rests (cover.ts); it wakes as the view starts to close.
  const present = useIsPresent();
  useEffect(() => { if (!present) { setViewerCovered(false); perfMark('close', 'start'); } }, [present]);
  useEffect(() => { perfMark('open', 'start'); return () => { setViewerCovered(false); perfMark('close', 'end'); }; }, []);
  const move = async (delta: -1 | 1) => {
    if (!nav || flying || sliding.current) return;
    const to = nav.index + delta;
    perfMark('swipe', 'start');
    if (to < 0 || to >= nav.count) { void animate(x, base, {type: 'spring', stiffness: 420, damping: 38}).then(() => perfMark('swipe', 'end')); return; }
    sliding.current = true; setError(null);
    navigator.vibrate?.(6);
    await animate(x, base - delta * step, {duration: 0.22, ease: [0.25, 0.8, 0.3, 1]});
    // the strip now rests where the new card's place in the deck puts it: nothing moves when the deck catches up
    sliding.current = false;
    nav.go(delta);
    perfMark('swipe', 'end');
  };
  useEffect(() => { setError(null); }, [card.name]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') move(-1);
      if (e.key === 'ArrowRight') move(1);
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });

  const fly: Fly = async (send) => {
    if (flying) return;
    setFlying(true); setError(null);
    navigator.vibrate?.(18);
    const launch = controls.start({y: -window.innerHeight * 1.25, rotate: -9, scale: 0.82, transition: {duration: 0.55, ease: [0.45, 0, 0.7, 0.2]}});
    const err = await send();
    await launch;
    if (err) {
      setError(err);
      navigator.vibrate?.([30, 50, 30]);
      await controls.start({y: 0, rotate: 0, scale: 1, transition: {type: 'spring', stiffness: 220, damping: 22}});
      setFlying(false);
    } else onClose();
  };

  const hasPrev = !!nav && nav.index > 0;
  const hasNext = !!nav && nav.index < nav.count - 1;
  return (
    // The backdrop is opaque: iOS turns backdrop blur off (styles.css), and a translucent scrim let the log
    // behind show through the controls.
    // On iPhones the open and close are a plain fade of this one layer (no shared-layout morph from the deck card,
    // whose layout projection flickers in WebKit); its will-change is pinned so the layer is not dropped at full
    // opacity. Once faded in, the page underneath is covered and rests.
    <motion.div role="dialog" aria-label={card.name} initial={{opacity: 0}} animate={{opacity: 1}} exit={{opacity: 0, transition: {duration: IS_IOS ? 0.18 : 0.25}}}
      transition={IS_IOS ? {duration: 0.18, ease: 'easeOut'} : undefined}
      onAnimationComplete={() => { if (present) { setViewerCovered(true); perfMark('open', 'end'); } }}
      style={{position: 'fixed', inset: 0, zIndex: 60, display: 'flex', flexDirection: 'column', alignItems: 'center', overflowY: 'auto', overflowX: 'hidden',
        overscrollBehavior: 'contain', background: '#0E0603', willChange: IS_IOS ? 'opacity' : undefined,
        padding: 'calc(18px + env(safe-area-inset-top)) 16px calc(24px + env(safe-area-inset-bottom))'}}>
      <div onClick={() => !flying && onClose()}
        style={{position: 'fixed', inset: 0, background: 'radial-gradient(90% 60% at 50% 35%, #3C180E, #0A0402)'}} />
      <div style={{position: 'relative', minHeight: 24, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 14, fontSize: 13, color: 'var(--ice-dim)'}}>
        <AnimatePresence>
          {canPlay && !flying && (
            <motion.span key="play" initial={{opacity: 0, y: 6}} animate={{opacity: 1, y: 0}} exit={{opacity: 0}} transition={{delay: 0.35}}
              style={{display: 'flex', alignItems: 'center', gap: 6}}>
              {/* the bobbing arrow repaints every frame; iPhones get it still */}
              <motion.svg width="14" height="14" viewBox="0 0 14 14" animate={IS_IOS ? undefined : {y: [2, -3, 2]}} transition={{duration: 1.4, repeat: Infinity}}>
                <path d="M7 12V2M3 6l4-4 4 4" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </motion.svg>
              Swipe up to play
            </motion.span>
          )}
        </AnimatePresence>
        {nav && nav.count > 1 && <span className="num" data-testid="viewer-pos" style={{fontSize: 13}}>{nav.index + 1} / {nav.count}</span>}
      </div>
      {/* the frame the card sits in; a played card flies off with it */}
      <motion.div animate={controls} style={{position: 'relative', width: cardW, height: cardH, flex: 'none'}}>
        <motion.div drag={!flying} dragDirectionLock onDirectionLock={(axis) => { if (axis === 'x') perfMark('swipe', 'start'); }} dragMomentum={false} dragConstraints={{top: 0, bottom: 0}}
          dragElastic={{top: canPlay ? 0.9 : 0.15, bottom: 0.5}}
          onDrag={(_, info) => {
            // resist at the ends of the deck
            if ((info.offset.x > 0 && !hasPrev) || (info.offset.x < 0 && !hasNext)) x.set(base + info.offset.x * 0.18);
          }}
          onDragEnd={(_, info) => {
            const sideways = Math.abs(info.offset.x) > Math.abs(info.offset.y);
            if (sideways) {
              if ((info.offset.x < -70 || info.velocity.x < -500) && hasNext) void move(1);
              else if ((info.offset.x > 70 || info.velocity.x > 500) && hasPrev) void move(-1);
              else void animate(x, base, {type: 'spring', stiffness: 420, damping: 38}).then(() => perfMark('swipe', 'end'));
              return;
            }
            if (canPlay && swipePlay && (info.offset.y < -110 || info.velocity.y < -650)) void fly(swipePlay);
            else if (info.offset.y > 130 || info.velocity.y > 700) onClose();
          }}
          transformTemplate={stripTransform}
          style={{position: 'absolute', left: 0, top: 0, width: cardW, height: cardH, touchAction: 'none', x, willChange: 'transform'}}>
          {[{c: prev, at: -1}, {c: {card, cost, resources, status}, at: 0}, {c: next, at: 1}].map(({c, at}) => c && (
            <div key={c.card.name} aria-hidden={at !== 0 || undefined}
              style={{position: 'absolute', top: 0, left: (index + at) * step, width: cardW, '--sheen': 0.7} as React.CSSProperties}>
              <CardFace variant="lifted" width={cardW} height={cardH} card={c.card} cost={c.cost} resources={c.resources} status={c.status} hints={hints[at]}
                layoutId={at === 0 && c.card.name === firstName.current ? layoutId : undefined} />
            </div>
          ))}
        </motion.div>
        {hasPrev && !flying && <NavArrow side="left" onClick={() => move(-1)} />}
        {hasNext && !flying && <NavArrow side="right" onClick={() => move(1)} />}
      </motion.div>
      {/* the controls sit on their own solid surface */}
      <div data-viewer-controls style={{position: 'relative', width: 'min(100%, 420px)', marginTop: 14, padding: 12, borderRadius: 22,
        background: '#1C0D08', boxShadow: 'inset 0 0 0 1px var(--rim), 0 10px 30px rgba(0,0,0,.45)'}}>
        <AnimatePresence>
          {error && (
            <motion.p role="alert" initial={{opacity: 0, height: 0}} animate={{opacity: 1, height: 'auto'}} exit={{opacity: 0, height: 0}}
              style={{margin: '0 0 10px', padding: '10px 12px', borderRadius: 12, background: 'rgba(226,80,46,.18)', color: '#FFB39E', fontWeight: 600}}>{error}</motion.p>
          )}
        </AnimatePresence>
        {/* keyed by card: the note and controls (payment, Use action) belong to the card in view */}
        <div key={card.name}>
          {note && <div className="muted" style={{fontSize: 14.5, marginBottom: 10, textAlign: 'center'}}>{note}</div>}
          {/* iPhones: the controls of the next card appear in place (a fade per swipe re-layered them) */}
          {children && <motion.div initial={IS_IOS ? false : {opacity: 0, y: 14}} animate={{opacity: flying ? 0.4 : 1, y: 0}} transition={{delay: IS_IOS ? 0 : 0.12}}>{children(fly)}</motion.div>}
        </div>
        <button className="btn ghost" style={{width: '100%', marginTop: 10}} onClick={onClose} disabled={flying}>{backLabel}</button>
      </div>
    </motion.div>
  );
}

function NavArrow({side, onClick}: {side: 'left' | 'right'; onClick: () => void}) {
  return (
    <motion.button type="button" aria-label={side === 'left' ? 'Previous card' : 'Next card'} data-testid={side === 'left' ? 'viewer-prev' : 'viewer-next'}
      onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onClick(); }}
      initial={IS_IOS ? false : {opacity: 0, scale: 0.8}} animate={{opacity: 1, scale: 1}} transition={{delay: 0.25}} whileTap={IS_IOS ? undefined : {scale: 0.9}}
      style={{position: 'absolute', top: '42%', [side]: -14, width: 40, height: 40, borderRadius: 20, display: 'grid', placeItems: 'center', zIndex: 4,
        background: 'rgba(20,9,6,.86)', boxShadow: 'inset 0 0 0 1.5px var(--rim-strong), 0 6px 16px rgba(0,0,0,.45)', color: 'var(--ice)'}}>
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        <path d={side === 'left' ? 'M10 3 5 8l5 5' : 'M6 3l5 5-5 5'} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </motion.button>
  );
}
