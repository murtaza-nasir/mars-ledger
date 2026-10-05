// The TR track: a numbered loop around the board (a rounded rectangle in the margin the board's box leaves), with a
// marker per player standing on their terraform rating. Markers hop from space to space when the rating changes,
// kick up a little dust on a long jump, fan out when ratings are equal or close, and the leader wiggles now and then.
// One static SVG (the band, 100 ticks, a number every five) and one small element per player, moved with transforms
// from a frame loop that runs only while something moves. It never reaches into the board's box.
import {useEffect, useLayoutEffect, useMemo, useRef} from 'react';
import {useReducedMotion} from 'motion/react';
import {PLAYER_HEX} from '../../ui/Icons';
import {Avatar} from '../../ui/Avatar';
import {hopAt, hopPlan, lapOf, LABEL_EVERY, leaderOf, perimeter, pointAt, slotPoint, spreadSlots, TRACK_LEN} from './trTrack';
import type {HopPlan, TrackShape} from './trTrack';

export type TrSeat = {color: string; name: string; tr: number; avatar: string | null};
type Rect = {left: number; top: number; width: number; height: number};

/** The band's thickness and the markers' diameter, as fractions of the screen's width. */
export const TRACK_BAND = 0.027;
export const TRACK_MARKER = 0.0235;
/** The board's box inside the room the track surrounds: inset by one band on every side. */
export function insetBox(r: Rect, vw: number): Rect {
  const b = Math.round(TRACK_BAND * vw);
  return {left: r.left + b, top: r.top + b, width: Math.max(0, r.width - 2 * b), height: Math.max(0, r.height - 2 * b)};
}

type Anim = {shown: number; plan: HopPlan | null; t0: number; target: number; off: number; lift: number; lastTr: number};
const FONT = "'Saira Variable'";

export function TrTrack({room, seats, vw}: {room: Rect; seats: TrSeat[]; vw: number}) {
  const reduced = !!useReducedMotion();
  const band = Math.round(TRACK_BAND * vw), size = Math.round(TRACK_MARKER * vw);
  const W = room.width, H = room.height;
  const shape = useMemo<TrackShape>(() => ({x: band / 2, y: band / 2, w: W - band, h: H - band, r: Math.min(vw * 0.05, (H - band) / 2)}), [band, W, H, vw]);
  const P = useMemo(() => perimeter(shape), [shape]);
  const gap = (size * 0.86) / (P / TRACK_LEN);   // markers closer than this (in spaces) fan out

  // ---- the static layer: band, ticks, numbers -------------------------------------------------------------------------
  const art = useMemo(() => {
    const minor: string[] = [], majorPath: string[] = [], labels: Array<{x: number; y: number; t: string}> = [];
    // ticks stand on the band's inner edge (the board's side), numbers sit outward of them, so a tick never reads as a minus sign
    const edge = band / 2 * 0.94;
    for (let i = 0; i < TRACK_LEN; i++) {
      const p = slotPoint(shape, i);   // a tick at the middle of each space
      const major = i % LABEL_EVERY === 0, len = band * (major ? 0.25 : 0.13);
      const line = `M${(p.x - p.nx * edge).toFixed(1)} ${(p.y - p.ny * edge).toFixed(1)}L${(p.x - p.nx * (edge - len)).toFixed(1)} ${(p.y - p.ny * (edge - len)).toFixed(1)}`;
      (major ? majorPath : minor).push(line);
      if (major) labels.push({x: p.x + p.nx * band * 0.13, y: p.y + p.ny * band * 0.13, t: String(i)});
    }
    const r = shape.r;
    const d = `M${shape.x + r} ${shape.y}H${shape.x + shape.w - r}A${r} ${r} 0 0 1 ${shape.x + shape.w} ${shape.y + r}V${shape.y + shape.h - r}A${r} ${r} 0 0 1 ${shape.x + shape.w - r} ${shape.y + shape.h}H${shape.x + r}A${r} ${r} 0 0 1 ${shape.x} ${shape.y + shape.h - r}V${shape.y + r}A${r} ${r} 0 0 1 ${shape.x + r} ${shape.y}Z`;
    return {minor: minor.join(''), major: majorPath.join(''), labels, d};
  }, [shape, band]);

  // ---- the markers --------------------------------------------------------------------------------------------------
  const els = useRef(new Map<string, HTMLDivElement | null>());
  const dust = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const anims = useRef(new Map<string, Anim>());
  const raf = useRef(0);
  const live = useRef({seats, shape, gap, size, reduced});
  live.current = {seats, shape, gap, size, reduced};
  const leader = leaderOf(seats.map((s) => ({color: s.color, tr: s.tr})));

  const paint = useRef<(now: number) => void>(() => {});
  paint.current = (now: number) => {
    const {seats: ss, shape: sh, gap: gp, size: sz} = live.current;
    let busy = false;
    // where each marker stands now: hopping ones between spaces, the rest on their rating
    const cur = ss.map((s) => {
      const a = anims.current.get(s.color);
      if (!a) return TRACK_LEN * 0;
      if (a.plan) {
        const h = hopAt(a.plan, now - a.t0);
        a.shown = h.tr; a.lift = h.lift;
        if (h.done) {
          const plan = a.plan; a.plan = null; a.lift = 0; a.shown = a.target;
          if (plan.puff && !live.current.reduced) puff(s.color, a.target);
        } else busy = true;
      }
      return ((a.shown % TRACK_LEN) + TRACK_LEN) % TRACK_LEN;
    });
    // fan out those that would sit on each other; a marker eases to its fan position rather than snapping
    const spread = spreadSlots(cur, gp);
    ss.forEach((s, i) => {
      const a = anims.current.get(s.color), el = els.current.get(s.color);
      if (!a || !el) return;
      let want = spread[i] - cur[i]; if (want > TRACK_LEN / 2) want -= TRACK_LEN; if (want < -TRACK_LEN / 2) want += TRACK_LEN;
      const k = live.current.reduced ? 1 : 0.22;
      a.off += (want - a.off) * k;
      if (Math.abs(want - a.off) > 0.004) busy = true; else a.off = want;
      const p = slotPoint(sh, cur[i] + a.off);
      const lift = a.lift;
      el.style.transform = `translate3d(${(p.x - sz / 2).toFixed(1)}px,${(p.y - sz / 2 - lift * sz * 0.62).toFixed(1)}px,0) scale(${(1 + lift * 0.2).toFixed(3)})`;
      el.style.zIndex = String(a.plan ? 30 : 10 + i);
    });
    raf.current = busy ? requestAnimationFrame((t) => paint.current(t)) : 0;
  };
  const wake = () => { if (!raf.current) raf.current = requestAnimationFrame((t) => paint.current(t)); };

  function puff(color: string, tr: number) {
    const host = dust.current, a = anims.current.get(color);
    if (!host || !a) return;
    const {shape: sh, size: sz} = live.current;
    const p = slotPoint(sh, ((tr % TRACK_LEN) + TRACK_LEN) % TRACK_LEN + a.off);
    const box = document.createElement('div');
    box.style.cssText = `position:absolute;left:${p.x.toFixed(1)}px;top:${p.y.toFixed(1)}px;width:0;height:0;pointer-events:none`;
    const n = 7;
    for (let i = 0; i < n; i++) {
      const d = document.createElement('span');
      const r = sz * (0.17 + 0.1 * ((i * 37) % 5) / 4);
      d.style.cssText = `position:absolute;left:${-r}px;top:${-r}px;width:${2 * r}px;height:${2 * r}px;border-radius:50%;background:radial-gradient(circle,rgba(240,184,140,1),rgba(206,128,92,.8) 55%,rgba(190,110,80,0))`;
      // the dots leave sideways along the track and a little up, outward from the board
      const ang = Math.PI * (0.08 + 0.84 * (i / (n - 1))) + Math.PI; // upper half-plane
      const dx = Math.cos(ang) * sz * (0.7 + 0.35 * ((i * 53) % 4) / 3), dy = Math.sin(ang) * sz * (0.5 + 0.3 * ((i * 29) % 3) / 2) - sz * 0.1;
      box.appendChild(d);
      d.animate([{transform: 'translate(0,0) scale(.5)', opacity: 0.95}, {transform: `translate(${dx.toFixed(1)}px,${dy.toFixed(1)}px) scale(1.9)`, opacity: 0}],
        {duration: 620 + (i % 3) * 90, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'forwards'});
    }
    host.appendChild(box);
    setTimeout(() => box.remove(), 900);
  }

  // a rating changed: plan its hops (or jump, when motion is reduced); a new seat appears where it stands
  useLayoutEffect(() => {
    const now = performance.now();
    for (const s of seats) {
      const a = anims.current.get(s.color);
      if (!a) { anims.current.set(s.color, {shown: s.tr, plan: null, t0: now, target: s.tr, off: 0, lift: 0, lastTr: s.tr}); continue; }
      if (a.target === s.tr) continue;
      a.target = s.tr;
      if (reduced) { a.shown = s.tr; a.plan = null; a.lift = 0; continue; }
      a.plan = hopPlan(a.shown, s.tr); a.t0 = now;
      if (!a.plan.steps.length) a.plan = null;
    }
    for (const c of [...anims.current.keys()]) if (!seats.some((s) => s.color === c)) anims.current.delete(c);
    paint.current(now); wake();
  }, [seats, reduced]);
  // a resized room or marker repaints at once
  useLayoutEffect(() => { paint.current(performance.now()); wake(); }, [shape, gap, size]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (raf.current) cancelAnimationFrame(raf.current); raf.current = 0; }, []);

  // while the camera is away from its resting view (a dive, a flight) the board is not where the track frames it: fade out
  useEffect(() => {
    const t = setInterval(() => {
      const h = (window as unknown as {__board3d?: {dive?: number; fog?: number; flying?: boolean; view?: {dist: number}; rest?: {dist: number}}}).__board3d;
      const away = !!h && (!!h.flying || (h.dive ?? 0) > 0.02 || (h.fog ?? 0) > 0.05 || (!!h.view && !!h.rest && Math.abs(h.view.dist - h.rest.dist) > h.rest.dist * 0.03));
      if (root.current) root.current.style.opacity = away ? '0.12' : '1';
    }, 150);
    return () => clearInterval(t);
  }, []);

  const mk = size;
  return (
    <div ref={root} aria-hidden="true" data-tr-track="" style={{position: 'absolute', left: room.left, top: room.top, width: W, height: H, pointerEvents: 'none', transition: 'opacity .45s ease'}}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{position: 'absolute', inset: 0, overflow: 'visible'}}>
        <path d={art.d} fill="none" stroke="rgba(226,170,140,.4)" strokeWidth={band + Math.max(2, band * 0.05)} />
        <path d={art.d} fill="none" stroke="rgba(16,7,4,.82)" strokeWidth={band} />
        <path d={art.minor} stroke="rgba(236,214,196,.5)" strokeWidth={Math.max(1, band * 0.03)} fill="none" />
        <path d={art.major} stroke="rgba(246,226,206,.9)" strokeWidth={Math.max(1.5, band * 0.05)} fill="none" />
        <g fill="rgba(246,232,218,.95)" fontFamily={FONT} fontWeight={700} fontSize={band * 0.44} textAnchor="middle" dominantBaseline="central" style={{fontVariationSettings: "'wdth' 85"}}>
          {art.labels.map((l) => <text key={l.t} x={l.x} y={l.y}>{l.t}</text>)}
        </g>
      </svg>
      <div ref={dust} style={{position: 'absolute', inset: 0}} />
      {seats.map((s) => {
        const hex = PLAYER_HEX[s.color] ?? '#999';
        const lead = s.color === leader;
        const lap = lapOf(s.tr);
        return (
          <div key={s.color} ref={(el) => { els.current.set(s.color, el); }} data-tr-marker={s.color} data-tr={s.tr} data-leader={lead ? '' : undefined}
            style={{position: 'absolute', left: 0, top: 0, width: mk, height: mk, willChange: 'transform', transform: 'translate3d(-999px,0,0)'}}>
            <div className={lead && !reduced ? 'tr-wiggle' : undefined} style={{position: 'relative', width: mk, height: mk, filter: 'drop-shadow(0 0.15vw 0.2vw rgba(0,0,0,.6))'}}>
              <Avatar name={s.name} color={s.color} avatar={s.avatar} size={mk} ring />
              {lead && <Crown size={mk * 0.62} hex={hex} />}
              {lap > 0 && <span className="num" style={{position: 'absolute', right: -mk * 0.22, bottom: -mk * 0.12, minWidth: mk * 0.46, height: mk * 0.46, padding: `0 ${mk * 0.08}px`, borderRadius: mk, background: hex, color: '#1a0d0a',
                font: `800 ${mk * 0.34}px ${FONT}`, display: 'grid', placeItems: 'center', boxShadow: '0 0 0 1.5px rgba(16,7,4,.8)'}}>+{lap * TRACK_LEN}</span>}
            </div>
          </div>
        );
      })}
      <style>{`
        @keyframes tr-wiggle { 0%, 70%, 100% { transform: rotate(0) } 74% { transform: rotate(-11deg) scale(1.06) } 80% { transform: rotate(10deg) scale(1.06) } 86% { transform: rotate(-7deg) } 92% { transform: rotate(4deg) } }
        .tr-wiggle { animation: tr-wiggle 6.5s ease-in-out infinite; transform-origin: 50% 80%; }
        @media (prefers-reduced-motion: reduce) { .tr-wiggle { animation: none } }
      `}</style>
    </div>
  );
}

function Crown({size, hex}: {size: number; hex: string}) {
  return (
    <svg width={size} height={size * 0.7} viewBox="0 0 20 14" style={{position: 'absolute', left: '50%', top: -size * 0.62, transform: 'translateX(-50%)', overflow: 'visible'}}>
      <path d="M2 12 L1 3.5 L6 7.5 L10 1.5 L14 7.5 L19 3.5 L18 12 Z" fill="#F2C230" stroke="#3a2406" strokeWidth="1.1" strokeLinejoin="round" />
      <circle cx="10" cy="9.2" r="1.3" fill={hex} stroke="#3a2406" strokeWidth=".6" />
    </svg>
  );
}
