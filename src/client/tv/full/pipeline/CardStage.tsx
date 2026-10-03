// A played card on the TV, in four phases (timings from pacing.ts):
//   1. anticipation: the player's chime, their panel pulses;
//   2. travel: the card flies from their panel to the centre of the board, ease-out, trailing their colour;
//   3. hold: it parks, completely still, while the board behind darkens;
//   4. resolution, one effect at a time: the card steps aside and the board brightens, gains fly to the panel, the
//      reticle pings the hex, the tile drops (the 3D board's own dive and build-in), then the card goes home.
// Only transforms and opacity move; the dimming is one static gradient whose opacity changes.
import {motion} from 'motion/react';
import {useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import type {CSSProperties, RefObject} from 'react';
import {findCard} from '../../../../shared/cards';
import type {PublicPlayerModel} from '../../../../shared/full';
import {PLAYER_HEX} from '../../../ui/Icons';
import {prefersReducedMotion} from '../../../ui/tokens';
import {director} from '../../sound/director';
import {cardCue} from '../../sound/cues';
import {TvCard} from '../../TvCard';
import {tvt} from '../../settings';
import {Flights} from '../ActionMoment';
import {useActionHolds} from '../actionHolds';
import type {CardMomentModel} from '../Moments';
import type {CardPlan} from './pacing';
import {cardKey, doneWaiting, pingHex, pulsePanel, releaseTiles, setDim, usePipeline} from './store';
import {sendResolve} from './resolve';
import {useFly} from '../board3d/flyStore';

type Stage = 'pre' | 'travel' | 'hold' | 'aside' | 'exit';
type Geo = {left: number; top: number; w: number; capH: number; cardH: number;
  from: {x: number; y: number; s: number}; aside: {x: number; y: number; s: number}};

/** The card's rules text length, for the hold (pacing.holdForText). */
export function cardTextLength(name: string): number {
  const d = findCard(name);
  return d ? d.text.join(' ').length : 40;
}

/** Panel centre to board centre as a share of the screen diagonal (pacing.travelFor). */
export function travelDistance(color: string, board: DOMRect | null): number {
  const strip = document.querySelector(`[data-strip-color="${color}"]`)?.getBoundingClientRect();
  if (!strip || !board) return 0.4;
  const dx = board.left + board.width / 2 - (strip.left + strip.width / 2);
  const dy = board.top + board.height / 2 - (strip.top + strip.height / 2);
  return Math.hypot(dx, dy) / Math.hypot(window.innerWidth, window.innerHeight);
}

function measure(color: string, board: DOMRect | null): Geo {
  const W = window.innerWidth, H = window.innerHeight;
  const cardW = Math.round(Math.min(W * 0.22, H * 0.6 * 63 / 88));
  const cardH = Math.round(cardW * 88 / 63);
  const capH = Math.round(W * 0.034);
  const blockH = capH + cardH;
  const b = board ?? new DOMRect(W * 0.12, H * 0.03, W * 0.55, H * 0.89);
  const cx = Math.min(W - cardW / 2 - 8, Math.max(cardW / 2 + 8, b.left + b.width / 2));
  const cy = Math.min(H - blockH / 2 - 8, Math.max(blockH / 2 + 8, b.top + b.height / 2));
  const strip = document.querySelector(`[data-strip-color="${color}"]`)?.getBoundingClientRect();
  const from = strip
    ? {x: strip.left + Math.min(strip.width, strip.height * 1.4) / 2 - cx, y: strip.top + strip.height / 2 - cy, s: Math.max(0.12, Math.min(0.4, strip.height / blockH))}
    : {x: W - cx, y: 0, s: 0.3};
  // Phase 4: half size, at the board's right edge just above the middle (towards the panels the gains fly to)
  const s = 0.5;
  const asideCx = b.left + b.width - (cardW * s) / 2 - W * 0.012;
  const asideCy = b.top + Math.max((blockH * s) / 2 + H * 0.02, b.height * 0.3);
  return {left: cx - cardW / 2, top: cy - blockH / 2, w: cardW, capH, cardH, from, aside: {x: asideCx - cx, y: asideCy - cy, s}};
}

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

export function CardStage({m, plan, players, boardRef}: {m: CardMomentModel; plan: CardPlan; players: PublicPlayerModel[]; boardRef: RefObject<HTMLDivElement | null>}) {
  const replay = !!m.replay;
  const reduced = useMemo(prefersReducedMotion, []);
  const color = PLAYER_HEX[m.color] ?? '#F2C230';
  const p = players.find((x) => x.color === m.color);
  const def = findCard(m.name);
  const [geo, setGeo] = useState<Geo | null>(null);
  const [stage, setStage] = useState<Stage>(replay ? 'hold' : 'pre');
  const [fly, setFly] = useState(false);
  const cardBox = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { setGeo(measure(m.color, boardRef.current?.getBoundingClientRect() ?? null)); }, [m.color, boardRef]);

  // The timeline. When moments pile up behind this one the plan shortens mid-way (FullTv hurries it): the phases not
  // reached yet are rescheduled from the moment's start, and any already overdue run at once, in order.
  const started = useRef(performance.now());
  const fired = useRef(new Set<string>());
  useEffect(() => {
    const dims = () => useFly.getState().phase === 'off';
    const tile = m.tiles?.[0]?.spaceId ?? m.replay?.spaceId;
    const events: Array<[string, number, () => void]> = [];
    const ev = (name: string, at: number, fn: () => void) => events.push([name, at, fn]);
    ev('start', 0, () => {
      if (!replay) { director.chime(m.color); pulsePanel(m.color, Math.max(500, plan.anticipation + 250)); } else if (dims()) setDim(true);
    });
    ev('travel', plan.anticipation, () => { if (!replay) setStage('travel'); if (m.sequenced) director.cue(cardCue(m.name)); });
    // the board darkens as the card arrives
    ev('dim', plan.anticipation + Math.round(plan.travel * 0.35), () => { if (dims()) setDim(true); });
    ev('hold', plan.holdAt, () => setStage('hold'));
    ev('resolve', plan.resolveAt, () => {
      setStage('aside');
      setDim(false);
      doneWaiting(cardKey(m.color, m.name));
      if (!replay && m.gameAge !== undefined) sendResolve(m.k, m.gameAge, m.color, m.targets ?? []);
    });
    if (plan.flights > 0 && m.gains?.length) ev('fly', plan.flightsAt, () => setFly(true));
    else if (!replay) ev('fly', plan.flightsAt, () => useActionHolds.getState().release((h) => h.moment === m.k));
    if (plan.pings > 0 && tile) {
      ev('ping', plan.reticleAt, () => {
        // a tile already let go (its deadline passed while the moment waited) has nothing left to point at
        if (replay || usePipeline.getState().tiles.some((t) => t.spaceId === tile && t.moment === m.k)) pingHex(tile, m.color, plan.pings, plan.ping);
      });
    }
    if (m.tiles?.length) ev('drop', plan.dropAt, () => releaseTiles((t) => t.moment === m.k));
    ev('exit', plan.exitAt, () => setStage('exit'));
    ev('done', plan.total, () => m.replay?.onDone?.());
    const elapsed = performance.now() - started.current;
    const ts = events.filter(([name]) => !fired.current.has(name))
      .map(([name, at, fn]) => setTimeout(() => { if (fired.current.has(name)) return; fired.current.add(name); fn(); }, Math.max(0, at - elapsed)));
    return () => ts.forEach(clearTimeout);
  }, [plan]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => setDim(false), []);
  // once the moment has gone, its panel cells show the latest view whatever is still in the air
  useEffect(() => () => { if (!replay) useActionHolds.getState().release((h) => h.moment === m.k); }, [m.k, replay]);

  if (!geo) return null;
  const sec = (ms: number) => Math.max(0.001, ms / 1000);
  const centre = {x: 0, y: 0, scale: 1, opacity: 1};
  const target: Record<Stage, {x: number; y: number; scale: number; opacity: number}> = {
    pre: reduced || replay ? {...centre, opacity: 0} : {x: geo.from.x, y: geo.from.y, scale: geo.from.s, opacity: 0},
    travel: centre,
    hold: centre,
    aside: {x: geo.aside.x, y: geo.aside.y, scale: geo.aside.s, opacity: 1},
    exit: reduced ? {x: geo.aside.x, y: geo.aside.y, scale: geo.aside.s, opacity: 0} : {x: geo.from.x, y: geo.from.y, scale: geo.from.s, opacity: 0},
  };
  const transition = stage === 'travel'
    ? (reduced ? {duration: sec(plan.travel)} : {duration: sec(plan.travel), ease: EASE_OUT, opacity: {duration: sec(plan.travel * 0.3)}})
    : stage === 'hold' && replay ? {duration: 0.3}
      : stage === 'aside' ? (reduced ? {duration: 0} : {duration: sec(plan.flightsAt - plan.resolveAt), ease: [0.4, 0, 0.2, 1] as const})
        : stage === 'exit' ? {duration: sec(plan.total - plan.exitAt), ease: [0.4, 0, 1, 1] as const}
          : {duration: 0};
  const verb = m.replay?.verb ?? (def?.type === 'event' ? 'played an event' : 'played');
  const block: CSSProperties = {position: 'absolute', left: geo.left, top: geo.top, width: geo.w, transformOrigin: '50% 50%', willChange: 'transform, opacity', pointerEvents: 'none'};
  return (
    <div data-card-stage={m.name} data-stage={stage} style={{position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 40}}>
      {/* the motion trail: soft panes in the player's colour following the card's path a little behind it */}
      {stage === 'travel' && !reduced && [1, 2, 3, 4].map((i) => (
        <motion.div key={i} aria-hidden="true" initial={target.pre} animate={{x: 0, y: 0, scale: 1, opacity: [0, 0.42 - i * 0.08, 0]}}
          transition={{duration: sec(plan.travel), ease: EASE_OUT, delay: i * 0.045, opacity: {duration: sec(plan.travel), times: [0, 0.3, 1], delay: i * 0.045}}}
          style={{...block, top: geo.top + geo.capH, height: geo.cardH, borderRadius: geo.w * 0.05,
            background: `linear-gradient(165deg, ${color}, color-mix(in oklab, ${color} 30%, transparent) 70%, transparent)`}} />
      ))}
      <motion.div initial={target.pre} animate={target[stage]} transition={transition} style={block}>
        <div className="cond" style={{height: geo.capH, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.6vw', fontSize: tvt(1.35), fontWeight: 700,
          whiteSpace: 'nowrap', textShadow: '0 0.15vw 0.8vw rgba(0,0,0,.9)'}}>
          <span style={{width: '0.95vw', height: '0.95vw', borderRadius: '0.22vw', background: color, flexShrink: 0, boxShadow: '0 0 0 0.12vw rgba(0,0,0,.4)'}} />
          <span style={{color}}>{p?.name ?? ''}</span>
          <span style={{fontWeight: 500, color: 'var(--ice)'}}>{verb}</span>
        </div>
        <div ref={cardBox} style={{borderRadius: geo.w * 0.045, boxShadow: `0 0 0 0.16vw ${color}, 0 2vw 4vw rgba(0,0,0,.65)`}}>
          {def
            ? <TvCard card={def} vw={(geo.w / window.innerWidth) * 100} maxVh={(geo.cardH + 2) / window.innerHeight} />
            : <div style={{height: geo.cardH, borderRadius: geo.w * 0.045, background: '#1A0B07', display: 'grid', placeItems: 'center', fontSize: tvt(1.6), fontWeight: 800}}>{m.name}</div>}
        </div>
      </motion.div>
      {fly && m.gains && <Flights moment={m.k} color={m.color} flights={m.gains} from={cardBox} merge={plan.mergeFlights} holds={!replay} />}
    </div>
  );
}

/** The board darkens behind a parked card: one static vignette whose opacity changes (cheap at any resolution). */
export function StageDim() {
  const dim = usePipeline((s) => s.dim);
  return (
    <motion.div aria-hidden="true" data-stage-dim={dim ? '1' : '0'} initial={false} animate={{opacity: dim ? 1 : 0}} transition={{duration: dim ? 0.35 : 0.3, ease: 'easeOut'}}
      style={{position: 'absolute', inset: 0, pointerEvents: 'none', willChange: 'opacity',
        background: 'radial-gradient(ellipse 62% 70% at 40% 50%, rgba(10,4,2,.3), rgba(10,4,2,.48) 60%, rgba(10,4,2,.62))'}} />
  );
}

/** Phase 1: the moving player's panel edge pulses in their colour. */
export function PanelPulse({color}: {color: string}) {
  const pulse = usePipeline((s) => (s.pulse?.color === color ? s.pulse : null));
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!pulse) return;
    setOn(true);
    const t = setTimeout(() => setOn(false), pulse.ms + 60);
    return () => clearTimeout(t);
  }, [pulse]);
  if (!pulse || !on) return null;
  const c = PLAYER_HEX[color] ?? '#fff';
  const d = pulse.ms / 1000;
  return (
    <motion.div key={pulse.at} aria-hidden="true" data-panel-pulse={color} initial={{opacity: 0}}
      animate={{opacity: [0, 1, 0.25, 0.9, 0]}} transition={{duration: d, times: [0, 0.22, 0.5, 0.7, 1], ease: 'easeInOut'}}
      style={{position: 'absolute', inset: '-0.25vw', borderRadius: '1.1vw', pointerEvents: 'none', zIndex: 3, willChange: 'opacity',
        boxShadow: `0 0 0 0.22vw ${c}, 0 0 1.6vw 0.3vw color-mix(in oklab, ${c} 70%, transparent)`}} />
  );
}
