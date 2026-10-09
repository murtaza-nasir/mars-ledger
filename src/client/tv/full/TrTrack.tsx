// The TR track: a frame of 100 numbered cells round the edge of the whole screen, like the track round the printed
// board, with a token per player standing on the cell of their terraform rating. Tokens hop from cell to cell when
// the rating changes (a hop lifts the token towards the camera, so it grows and moves a little in from the edge),
// kick up a ring of dust on a long jump, share a cell when ratings are equal, and the leader wears a crown and
// wiggles now and then. Everything else on the TV sits inside the frame: the band's depth is published as the CSS
// variable --trb (clearOfFrame), and the board's region is measured inside it.
// One static SVG (the band, 100 cells and their numbers) and one small element per player, moved with transforms
// from a frame loop that runs only while something moves. No WebGL.
import {useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {useReducedMotion} from 'motion/react';
import {PLAYER_HEX} from '../../ui/Icons';
import {Avatar} from '../../ui/Avatar';
import {cellCenter, frameLayout, hopAt, hopPlan, inward, lapOf, leaderOf, MAJOR_EVERY, MARKER, stackPlaces, TRACK_LEN} from './trTrack';
import type {Frame, HopPlan} from './trTrack';

export type TrSeat = {color: string; name: string; tr: number; avatar: string | null};

/**
 * The frame for this screen while the track is on (null while it is off), kept up to date on resize. It also sets
 * --trb on the root element (the band's depth in px; removed when off), which every edge-anchored part of the TV
 * reads through clearOfFrame. Set before paint, so the layout never shows a frame over its edges.
 */
export function useTrFrame(on: boolean): Frame | null {
  const [size, setSize] = useState(() => [window.innerWidth, window.innerHeight] as const);
  useEffect(() => {
    const read = () => setSize((p) => (p[0] === window.innerWidth && p[1] === window.innerHeight ? p : [window.innerWidth, window.innerHeight]));
    window.addEventListener('resize', read);
    return () => window.removeEventListener('resize', read);
  }, []);
  const frame = useMemo(() => (on ? frameLayout(size[0], size[1]) : null), [on, size]);
  useLayoutEffect(() => {
    const root = document.documentElement.style;
    if (frame) root.setProperty('--trb', `${frame.band}px`); else root.removeProperty('--trb');
    return () => { root.removeProperty('--trb'); };
  }, [frame]);
  (window as unknown as {__trFrame?: unknown}).__trFrame = frame && {band: frame.band, across: frame.across, down: frame.down};
  return frame;
}

type Anim = {shown: number; plan: HopPlan | null; t0: number; target: number; dx: number; dy: number; sz: number; lift: number};
const FONT = "'Saira Variable'";

export function TrTrack({frame, seats}: {frame: Frame; seats: TrSeat[]}) {
  const reduced = !!useReducedMotion();
  const b = frame.band, mk = Math.round(b * MARKER);

  // ---- the static layer: band, cells, numbers -----------------------------------------------------------------------
  const art = useMemo(() => {
    const gap = Math.max(1, Math.round(b * 0.05));
    const r = Math.max(1, b * 0.11);
    const cells = frame.cells.map((c) => {
      const major = c.i % MAJOR_EVERY === 0, ten = c.i % 10 === 0;
      return {i: c.i, x: c.x + gap / 2, y: c.y + gap / 2, w: c.w - gap, h: c.h - gap, major, ten, corner: c.corner,
        tx: c.x + c.w / 2, ty: c.y + c.h / 2 + b * 0.02};
    });
    const {W, H} = frame;
    // the band's floor: the whole ring, outer edge to inner edge (the cells sit on it, the gaps show it)
    const ring = `M0 0H${W}V${H}H0Z M${b} ${b}V${H - b}H${W - b}V${b}Z`;
    return {cells, ring, r, gap};
  }, [frame, b]);

  // ---- the tokens ---------------------------------------------------------------------------------------------------
  const els = useRef(new Map<string, HTMLDivElement | null>());
  const dust = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const anims = useRef(new Map<string, Anim>());
  const raf = useRef(0);
  const live = useRef({seats, frame, reduced});
  live.current = {seats, frame, reduced};
  const leader = leaderOf(seats.map((s) => ({color: s.color, tr: s.tr})));

  const paint = useRef<(now: number) => void>(() => {});
  paint.current = (now: number) => {
    const {seats: ss, frame: fr} = live.current;
    const bb = fr.band, m = Math.round(bb * MARKER);
    let busy = false;
    // where each token stands now: hopping ones between cells (alone, full size), the rest on their rating's cell
    const cur = ss.map((s) => {
      const a = anims.current.get(s.color);
      if (!a) return {slot: 0, hopping: false};
      let hopping = false;
      if (a.plan) {
        const h = hopAt(a.plan, now - a.t0);
        a.shown = h.tr; a.lift = h.lift;
        if (h.done) {
          const plan = a.plan; a.plan = null; a.lift = 0; a.shown = a.target;
          if (plan.puff && !live.current.reduced) puff(a.target);
        } else { busy = true; hopping = true; }
      }
      return {slot: ((a.shown % TRACK_LEN) + TRACK_LEN) % TRACK_LEN, hopping};
    });
    const places = stackPlaces(cur.map((c) => (c.hopping ? null : Math.round(c.slot) % TRACK_LEN)));
    ss.forEach((s, i) => {
      const a = anims.current.get(s.color), el = els.current.get(s.color);
      if (!a || !el) return;
      // a token eases to its place in a shared cell rather than snapping
      const want = places[i], k = live.current.reduced ? 1 : 0.24;
      a.dx += (want.dx - a.dx) * k; a.dy += (want.dy - a.dy) * k; a.sz += (want.size - a.sz) * k;
      if (Math.abs(want.dx - a.dx) + Math.abs(want.dy - a.dy) + Math.abs(want.size - a.sz) > 0.003) busy = true;
      else { a.dx = want.dx; a.dy = want.dy; a.sz = want.size; }
      const c = cellCenter(fr, cur[i].slot);
      const into = inward(fr.cells[Math.round(cur[i].slot) % TRACK_LEN]);
      const lift = a.lift;
      const x = c.x + a.dx * bb + into.x * lift * bb * 0.3, y = c.y + a.dy * bb + into.y * lift * bb * 0.3;
      const scale = (a.sz / MARKER) * (1 + lift * 0.42);
      el.style.transform = `translate3d(${(x - m / 2).toFixed(1)}px,${(y - m / 2).toFixed(1)}px,0) scale(${scale.toFixed(3)})`;
      el.style.zIndex = String(cur[i].hopping ? 30 : 10 + i);
    });
    raf.current = busy ? requestAnimationFrame((t) => paint.current(t)) : 0;
  };
  const wake = () => { if (!raf.current) raf.current = requestAnimationFrame((t) => paint.current(t)); };

  // a ring of dust round the cell a long jump lands on, flung along the band and in towards the board
  function puff(tr: number) {
    const host = dust.current;
    if (!host) return;
    const {frame: fr} = live.current, bb = fr.band;
    const slot = ((Math.round(tr) % TRACK_LEN) + TRACK_LEN) % TRACK_LEN;
    const p = cellCenter(fr, slot), into = inward(fr.cells[slot]);
    const box = document.createElement('div');
    box.style.cssText = `position:absolute;left:${p.x.toFixed(1)}px;top:${p.y.toFixed(1)}px;width:0;height:0;pointer-events:none`;
    const n = 9, base = Math.atan2(into.y, into.x);
    for (let i = 0; i < n; i++) {
      const d = document.createElement('span');
      const r = bb * (0.13 + 0.08 * ((i * 37) % 5) / 4);
      d.style.cssText = `position:absolute;left:${-r}px;top:${-r}px;width:${2 * r}px;height:${2 * r}px;border-radius:50%;background:radial-gradient(circle,rgba(240,184,140,1),rgba(206,128,92,.8) 55%,rgba(190,110,80,0))`;
      // a fan of 220 degrees centred on the way in: none of it is lost off the screen's edge
      const ang = base + (Math.PI * 1.22) * (i / (n - 1) - 0.5);
      const reach = bb * (0.55 + 0.3 * ((i * 53) % 4) / 3);
      const dx = Math.cos(ang) * reach, dy = Math.sin(ang) * reach;
      box.appendChild(d);
      d.animate([{transform: 'translate(0,0) scale(.5)', opacity: 0.95}, {transform: `translate(${dx.toFixed(1)}px,${dy.toFixed(1)}px) scale(1.8)`, opacity: 0}],
        {duration: 600 + (i % 3) * 90, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'forwards'});
    }
    host.appendChild(box);
    setTimeout(() => box.remove(), 900);
  }

  // a rating changed: plan its hops (or jump, when motion is reduced); a new seat appears where it stands
  useLayoutEffect(() => {
    const now = performance.now();
    for (const s of seats) {
      const a = anims.current.get(s.color);
      if (!a) { anims.current.set(s.color, {shown: s.tr, plan: null, t0: now, target: s.tr, dx: 0, dy: 0, sz: MARKER, lift: 0}); continue; }
      if (a.target === s.tr) continue;
      a.target = s.tr;
      if (reduced) { a.shown = s.tr; a.plan = null; a.lift = 0; continue; }
      a.plan = hopPlan(a.shown, s.tr); a.t0 = now;
      if (!a.plan.steps.length) a.plan = null;
    }
    for (const c of [...anims.current.keys()]) if (!seats.some((s) => s.color === c)) anims.current.delete(c);
    paint.current(now); wake();
  }, [seats, reduced]);
  // a resized screen repaints at once
  useLayoutEffect(() => { paint.current(performance.now()); wake(); }, [frame]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (raf.current) cancelAnimationFrame(raf.current); raf.current = 0; }, []);

  // while the camera dives or flies the frame steps back a little, so the shot has the screen
  useEffect(() => {
    const t = setInterval(() => {
      const h = (window as unknown as {__board3d?: {dive?: number; fog?: number; flying?: boolean; view?: {dist: number}; rest?: {dist: number}}}).__board3d;
      const away = !!h && (!!h.flying || (h.dive ?? 0) > 0.02 || (h.fog ?? 0) > 0.05 || (!!h.view && !!h.rest && Math.abs(h.view.dist - h.rest.dist) > h.rest.dist * 0.03));
      if (root.current) root.current.style.opacity = away ? '0.45' : '1';
    }, 150);
    return () => clearInterval(t);
  }, []);

  const {W, H} = frame;
  return (
    <div ref={root} aria-hidden="true" data-tr-track="" data-tr-band={b} style={{position: 'absolute', left: 0, top: 0, width: W, height: H, pointerEvents: 'none', transition: 'opacity .45s ease'}}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{position: 'absolute', inset: 0}}>
        <defs>
          <linearGradient id="trc" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#3B2019" /><stop offset="1" stopColor="#26130E" />
          </linearGradient>
          <linearGradient id="trc5" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#4C281C" /><stop offset="1" stopColor="#311810" />
          </linearGradient>
          <linearGradient id="trc10" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#5A2A1C" /><stop offset="1" stopColor="#3A1A11" />
          </linearGradient>
        </defs>
        <path d={art.ring} fill="#0D0503" fillRule="evenodd" />
        {art.cells.map((c) => (
          <rect key={c.i} x={c.x} y={c.y} width={c.w} height={c.h} rx={art.r} fill={c.ten ? 'url(#trc10)' : c.major ? 'url(#trc5)' : 'url(#trc)'}
            stroke={c.ten ? 'rgba(240,130,90,.34)' : 'rgba(255,196,160,.12)'} strokeWidth={Math.max(1, b * 0.025)} />
        ))}
        {/* a bevel: light along the top of each cell, shade along its foot */}
        <path d={art.cells.map((c) => `M${(c.x + art.r).toFixed(1)} ${(c.y + 1.2).toFixed(1)}H${(c.x + c.w - art.r).toFixed(1)}`).join('')}
          stroke="rgba(255,214,186,.16)" strokeWidth={Math.max(1, b * 0.03)} fill="none" />
        <path d={art.cells.map((c) => `M${(c.x + art.r).toFixed(1)} ${(c.y + c.h - 1.2).toFixed(1)}H${(c.x + c.w - art.r).toFixed(1)}`).join('')}
          stroke="rgba(0,0,0,.35)" strokeWidth={Math.max(1, b * 0.03)} fill="none" />
        {/* the inner edge of the frame, where the TV's own layout begins */}
        <rect x={b - 0.5} y={b - 0.5} width={W - 2 * b + 1} height={H - 2 * b + 1} fill="none" stroke="rgba(255,196,160,.16)" strokeWidth={1} />
        <g fontFamily={FONT} textAnchor="middle" dominantBaseline="central" style={{fontVariationSettings: "'wdth' 88", fontVariantNumeric: 'tabular-nums'}}>
          {art.cells.map((c) => (
            <text key={c.i} x={c.tx} y={c.ty} fontSize={b * (c.major ? 0.46 : 0.36)} fontWeight={c.major ? 750 : 600}
              fill={c.ten ? 'rgba(255,236,222,.9)' : c.major ? 'rgba(246,226,210,.8)' : 'rgba(234,214,200,.46)'}>{c.i}</text>
          ))}
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
            <div className={lead && !reduced ? 'tr-wiggle' : undefined} style={{position: 'relative', width: mk, height: mk, filter: `drop-shadow(0 ${(b * 0.05).toFixed(1)}px ${(b * 0.06).toFixed(1)}px rgba(0,0,0,.75))`}}>
              <Avatar name={s.name} color={s.color} avatar={s.avatar} size={mk} ring />
              {lead && <Crown size={mk * 0.52} hex={hex} />}
              {lap > 0 && <span className="num" style={{position: 'absolute', right: -mk * 0.14, bottom: -mk * 0.04, minWidth: mk * 0.5, height: mk * 0.42, padding: `0 ${mk * 0.07}px`, borderRadius: mk, background: hex, color: '#1a0d0a',
                font: `800 ${mk * 0.3}px ${FONT}`, display: 'grid', placeItems: 'center', boxShadow: '0 0 0 1.5px rgba(16,7,4,.8)'}}>+{lap * TRACK_LEN}</span>}
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

/** The leader's crown, worn low over the top of the token so it stays on screen on the top row. */
function Crown({size, hex}: {size: number; hex: string}) {
  return (
    <svg width={size} height={size * 0.7} viewBox="0 0 20 14" style={{position: 'absolute', left: '50%', top: -size * 0.34, transform: 'translateX(-50%) rotate(-8deg)', overflow: 'visible'}}>
      <path d="M2 12 L1 3.5 L6 7.5 L10 1.5 L14 7.5 L19 3.5 L18 12 Z" fill="#F2C230" stroke="#3a2406" strokeWidth="1.1" strokeLinejoin="round" />
      <circle cx="10" cy="9.2" r="1.3" fill={hex} stroke="#3a2406" strokeWidth=".6" />
    </svg>
  );
}
