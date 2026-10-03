// The production show on the TV. Mars erupts with every player's income; the tokens fountain up,
// then fly out of the screen toward each player's strip (and on into their phones).
// Every particle is a pure function of time, so a late or resumed frame lands in the right place.
import {AnimatePresence, motion} from 'motion/react';
import {useEffect, useMemo, useRef, useState} from 'react';
import type {ProductionShow} from '../../../shared/full';
import {SHOW_RESOURCES, tokenValues} from '../../../shared/production';
import type {Resource} from '../../../shared/types';
import {useNet} from '../../net';
import {heldValue} from '../../../shared/sync';
import {PLAYER_HEX, ResIcon} from '../../ui/Icons';
import {clamp01, drawSpark, drawToken, easeInCubic, easeOutCubic, fitCanvas, hashString, preloadTokens, prefersReducedMotion, rng, TOKEN_HEX} from '../../ui/tokens';
import type {TokenKind} from '../../ui/tokens';
import {tvt} from '../settings';

type LiveShow = ProductionShow & {localStart: number};

// the tokens are drawn from bitmaps baked once per kind: bake them while the TV loads, not on the first show
if (typeof window !== 'undefined') setTimeout(preloadTokens, 2500);

/** Timeline, seconds from the show's start. Phones use the same numbers (see phone/full/Production.tsx). */
export const T = {dim: 0, burst: 0.3, erupt: 0.45, flyOut: 1.95, release: 2.35, chips: 2.9, fadeOut: 5.9, end: 6.8};

/** The current show while it is playing (or about to), else null. Re-renders ~10x a second while active. */
export function useLiveShow(): {show: LiveShow; t: number} | null {
  const show = useNet((s) => s.production);
  const [now, setNow] = useState(() => Date.now());
  const active = !!show && now < show.localStart + show.durationMs;
  useEffect(() => {
    if (!show) return;
    setNow(Date.now());
    const i = setInterval(() => {
      const n = Date.now();
      setNow(n);
      if (n > show.localStart + show.durationMs) clearInterval(i);
    }, 100);
    return () => clearInterval(i);
  }, [show]);
  if (!show || !active) return null;
  return {show, t: (now - show.localStart) / 1000};
}

/**
 * Strip numbers hold at the pre-production value until that player's tokens leave the screen. The release is a hard
 * deadline on the wall clock (`now`), not the last tick of the show's timer: a late or frozen timer, or a newer view
 * arriving mid-hold, re-renders the strip with the latest numbers once the deadline is past.
 */
export function stripOverride(live: {show: LiveShow; t: number} | null, color: string, now = Date.now()): Record<Resource, number> | undefined {
  if (!live) return undefined;
  const i = live.show.players.findIndex((p) => p.color === color);
  const p = live.show.players[i];
  if (!p) return undefined;
  return heldValue({display: p.before, until: stripReleaseAt(live.show, i)}, now);
}

/** When player i's strip lets go of its pre-production numbers (local ms). */
export function stripReleaseAt(show: {localStart: number}, i: number): number {
  return show.localStart + (T.release + i * 0.1) * 1000;
}

type Token = {
  kind: TokenKind; morph?: TokenKind; player: number;
  x0: number; y0: number; vx: number; vy: number; spin: number; size: number;
  launch: number; out: number; outDur: number; tx: number; ty: number; ox: number; oy: number;
};
type Spark = {x: number; y: number; vx: number; vy: number; t0: number; life: number; color: string; size: number; gravity: number};

// The TV shows more tokens than units: it is a celebration, the phones do the exact counting.
const MAX_PER_RES: Record<Resource, number> = {megacredits: 34, steel: 12, titanium: 12, plants: 12, energy: 10, heat: 12};
const SHOWN = (amount: number) => (amount <= 0 ? 0 : Math.round(Math.max(4, amount * 1.6)));
const CAP = 600;

/** Where a player's tokens land: their panel, and each resource's own cell in it when it is on screen. */
type Target = {strip?: DOMRect; cells: Partial<Record<Resource, DOMRect>>};

function build(show: LiveShow, w: number, h: number, origin: {x: number; y: number}, targets: Record<string, Target | undefined>) {
  const r = rng(hashString(show.id));
  const u = h / 1080;
  const tokens: Token[] = [];
  const sparks: Spark[] = [];
  show.players.forEach((p, pi) => {
    const rect = targets[p.color]?.strip;
    const tx = rect ? rect.left + rect.width * 0.2 : w * 0.85;
    const ty = rect ? rect.top + rect.height / 2 : h * (0.2 + pi * 0.18);
    // each token heads for its resource's cell (energy turning to heat lands on heat)
    const aim = (res: Resource) => {
      const c = targets[p.color]?.cells[res];
      return c ? {x: c.left + c.width / 2, y: c.top + c.height / 2, sx: c.width * 0.6, sy: c.height * 0.5} : {x: tx, y: ty, sx: 80 * u, sy: 60 * u};
    };
    const kinds: Array<[Resource, number, TokenKind?]> = [];
    for (const res of SHOW_RESOURCES) {
      const amount = res === 'heat' ? p.gains.heat - p.energyToHeat : p.gains[res];
      for (let k = 0; k < tokenValues(SHOWN(amount), MAX_PER_RES[res]).length; k++) kinds.push([res, 1]);
    }
    for (let k = 0; k < tokenValues(SHOWN(p.energyToHeat), 10).length; k++) kinds.push(['energy', 1, 'flame']);
    kinds.forEach(([kind, , morph]) => {
      if (tokens.length >= CAP) return;
      const at = aim(morph ? 'heat' : kind);
      const ang = -Math.PI / 2 + (r() - 0.5) * 2.5;
      const sp = (620 + r() * 520) * u;
      const launch = T.erupt + pi * 0.14 + r() * 0.5;
      const out = T.flyOut + pi * 0.1 + r() * 0.38;
      // fly past the strip and off the screen's right edge, growing as if coming at the viewer
      const dx = at.x - origin.x;
      const dy = at.y - origin.y;
      const len = Math.hypot(dx, dy) || 1;
      tokens.push({
        kind, morph, player: pi, x0: origin.x + (r() - 0.5) * 60 * u, y0: origin.y + (r() - 0.5) * 40 * u,
        vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, spin: (r() - 0.5) * 9, size: (46 + r() * 26) * u * (kind === 'megacredits' ? 1.12 : 1),
        launch, out, outDur: 0.62 + r() * 0.25, tx: at.x + (r() - 0.5) * at.sx, ty: at.y + (r() - 0.5) * at.sy,
        ox: at.x + (dx / len) * w * 0.45 + (r() - 0.2) * 200 * u, oy: at.y + (dy / len) * h * 0.25 + (r() - 0.5) * 300 * u,
      });
    });
    // release sparks where this player's tokens leave
    const colors = SHOW_RESOURCES.filter((res) => p.gains[res] > 0).map((res) => TOKEN_HEX[res]);
    for (let k = 0; k < 26; k++) {
      const a = r() * Math.PI * 2;
      const s = (260 + r() * 520) * u;
      sparks.push({x: tx, y: ty, vx: Math.cos(a) * s, vy: Math.sin(a) * s, t0: T.release + pi * 0.1 + r() * 0.2, life: 0.7 + r() * 0.5,
        color: colors[k % Math.max(1, colors.length)] ?? PLAYER_HEX[p.color], size: (2 + r() * 3) * u, gravity: 500 * u});
    }
  });
  // the central burst
  const burstColors = Object.values(TOKEN_HEX);
  for (let k = 0; k < 150; k++) {
    const a = r() * Math.PI * 2;
    const s = (380 + r() * 900) * u;
    sparks.push({x: origin.x, y: origin.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, t0: T.burst + r() * 0.12, life: 0.8 + r() * 0.7,
      color: burstColors[k % burstColors.length], size: (2 + r() * 3.5) * u, gravity: 420 * u});
  }
  // gentle confetti from the top while the totals show
  for (let k = 0; k < 90; k++) {
    sparks.push({x: r() * w, y: -20 * u, vx: (r() - 0.5) * 80 * u, vy: (160 + r() * 200) * u, t0: T.chips + r() * 1.6, life: 2.4 + r(),
      color: burstColors[k % burstColors.length], size: (3 + r() * 3) * u, gravity: 60 * u});
  }
  return {tokens, sparks};
}

const GRAVITY = 1500;

/** Drawing detail: 2 everything; 1 without the tokens' motion trails; 0 also every other spark. The show steps down
 *  when this screen's frames run long (a slow TV), and never steps back up within a show. */
type Detail = 0 | 1 | 2;

function frame(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, origin: {x: number; y: number}, tokens: Token[], sparks: Spark[], detail: Detail = 2) {
  ctx.clearRect(0, 0, w, h);
  const u = h / 1080;
  // shock ring at the burst
  const rt = (t - T.burst) / 0.9;
  if (rt > 0 && rt < 1) {
    ctx.globalAlpha = (1 - rt) * 0.8;
    ctx.strokeStyle = '#F2C230';
    ctx.lineWidth = 10 * u * (1 - rt) + 1;
    ctx.beginPath();
    ctx.arc(origin.x, origin.y, easeOutCubic(rt) * 460 * u, 0, Math.PI * 2);
    ctx.stroke();
    const glow = ctx.createRadialGradient(origin.x, origin.y, 0, origin.x, origin.y, 260 * u);
    glow.addColorStop(0, `rgba(255,214,120,${0.55 * (1 - rt)})`);
    glow.addColorStop(1, 'rgba(255,214,120,0)');
    ctx.globalAlpha = 1;
    ctx.fillStyle = glow;
    ctx.fillRect(origin.x - 260 * u, origin.y - 260 * u, 520 * u, 520 * u);
  }
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < sparks.length; i += detail === 0 ? 2 : 1) {
    const s = sparks[i];
    const st = t - s.t0;
    if (st < 0 || st > s.life) continue;
    const x = s.x + s.vx * st;
    const y = s.y + s.vy * st + 0.5 * s.gravity * st * st;
    drawSpark(ctx, x, y, s.vx, s.vy + s.gravity * st, s.size, s.color, 1 - st / s.life);
  }
  ctx.globalCompositeOperation = 'source-over';
  const g = GRAVITY * u;
  for (const k of tokens) {
    const lt = t - k.launch;
    if (lt < 0) continue;
    const ot = (t - k.out) / k.outDur;
    if (ot >= 1) continue;
    let x: number; let y: number; let vx: number; let vy: number; let size = k.size; let a = 1;
    // ballistic fountain, with drag so the arc hangs at the top
    const bt = Math.min(lt, k.out - k.launch);
    const drag = Math.exp(-bt * 1.6);
    const bx = k.x0 + (k.vx / 1.6) * (1 - drag);
    const by = k.y0 + (k.vy / 1.6) * (1 - drag) + 0.5 * g * 0.3 * bt * bt;
    if (ot < 0) {
      x = bx; y = by; vx = k.vx * drag; vy = k.vy * drag + g * 0.3 * bt;
      size *= easeOutCubic(clamp01(lt / 0.25));
    } else {
      // out of the screen: accelerate through the strip and past the edge, swelling toward the viewer
      const e = easeInCubic(ot);
      const mx = bx + (k.tx - bx) * Math.min(1, e * 1.6);
      const my = by + (k.ty - by) * Math.min(1, e * 1.6);
      x = mx + (k.ox - k.tx) * Math.max(0, e * 1.6 - 0.6);
      y = my + (k.oy - k.ty) * Math.max(0, e * 1.6 - 0.6);
      const nt = Math.min(1, ot + 0.02);
      const ne = easeInCubic(nt);
      vx = ((k.tx - bx) + (k.ox - k.tx)) * 3 * ne * ne / k.outDur;
      vy = ((k.ty - by) + (k.oy - k.ty)) * 3 * ne * ne / k.outDur;
      size *= 1 + 6 * e * e;
      a = ot < 0.72 ? 1 : 1 - (ot - 0.72) / 0.28;
    }
    let kind = k.kind;
    if (k.morph) {
      // energy arcs over and catches fire: bolt to flame at the top of the arc, with a flicker
      const mt = clamp01((lt - 0.55) / 0.25);
      if (mt > 0) {
        const flick = 0.85 + 0.15 * Math.sin(t * 40 + k.x0);
        if (mt < 1) drawToken(ctx, 'energy', x, y, size * (1 - mt * 0.3), t * k.spin, a * (1 - mt), vx, vy, detail === 2);
        drawToken(ctx, k.morph, x, y, size * (0.7 + 0.4 * mt) * flick, 0, a * mt, vx, vy, detail === 2);
        continue;
      }
      kind = 'energy';
    }
    drawToken(ctx, kind, x, y, size, t * k.spin * (ot > 0 ? 2.2 : 1), a, vx, vy, detail === 2);
  }
}

export function ProductionShowTv({live, boardRef, stripRefs}: {
  live: {show: LiveShow; t: number};
  boardRef: React.RefObject<HTMLDivElement | null>;
  stripRefs: React.RefObject<Record<string, HTMLDivElement | null>>;
}) {
  const {show} = live;
  const canvas = useRef<HTMLCanvasElement>(null);
  const reduced = useMemo(prefersReducedMotion, []);
  useEffect(() => { preloadTokens(); }, []);

  useEffect(() => {
    if (reduced) return;
    const c = canvas.current;
    if (!c) return;
    let raf = 0;
    let built: ReturnType<typeof build> | null = null;
    let origin = {x: 0, y: 0};
    let size = '';
    // frame-time watch: a smoothed frame time over 24 ms steps the detail down (see Detail)
    let detail: Detail = 2, last = 0, avg = 16.7, slowFor = 0;
    const loop = (now: number) => {
      if (last) {
        avg += (Math.min(100, now - last) - avg) * 0.2;
        slowFor = avg > 24 ? slowFor + 1 : 0;
        if (slowFor >= 6 && detail > 0) { detail = (detail - 1) as Detail; slowFor = 0; avg = 16.7; }
      }
      last = now;
      (window as unknown as {__showDetail?: number}).__showDetail = detail;
      const {ctx, w, h} = fitCanvas(c);
      if (!built || size !== `${w}x${h}`) {
        size = `${w}x${h}`;
        const b = boardRef.current?.getBoundingClientRect();
        origin = b ? {x: b.left + b.width / 2, y: b.top + b.height / 2} : {x: w * 0.42, y: h * 0.47};
        const targets: Record<string, Target | undefined> = {};
        for (const p of show.players) {
          const el = stripRefs.current?.[p.color];
          if (!el) continue;
          const cells: Target['cells'] = {};
          for (const res of SHOW_RESOURCES) {
            const c = el.querySelector(`[data-res-cell="${res}"]`)?.getBoundingClientRect();
            if (c) cells[res] = c;
          }
          targets[p.color] = {strip: el.getBoundingClientRect(), cells};
        }
        built = build(show, w, h, origin, targets);
      }
      const t = (Date.now() - show.localStart) / 1000;
      frame(ctx, w, h, t, origin, built.tokens, built.sparks, detail);
      if (t < T.end) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [show, reduced, boardRef, stripRefs]);

  const t = live.t;
  const showTitle = t >= 0.05 && t < T.fadeOut;
  const showChips = t >= T.chips && t < T.fadeOut;
  return (
    <div aria-live="polite" style={{position: 'absolute', inset: 0, zIndex: 40, pointerEvents: 'none'}}>
      <motion.div initial={{opacity: 0}} animate={{opacity: t < T.fadeOut ? 1 : 0}} transition={{duration: t < T.fadeOut ? 0.45 : 0.8}}
        style={{position: 'absolute', inset: 0, background: 'radial-gradient(55% 60% at 42% 48%, rgba(16,7,4,.25), rgba(16,7,4,.72))'}} />
      <canvas ref={canvas} style={{position: 'absolute', inset: 0, width: '100%', height: '100%'}} />
      <div style={{position: 'absolute', left: '17vw', width: '50vw', top: '9vh', textAlign: 'center'}}>
        <AnimatePresence>
          {showTitle && (
            <motion.div key="title" initial={{opacity: 0, scale: 1.35, letterSpacing: '0.35em', filter: 'blur(12px)'}}
              animate={{opacity: 1, scale: 1, letterSpacing: '-0.01em', filter: 'blur(0px)'}} exit={{opacity: 0, y: -30, filter: 'blur(8px)'}}
              transition={{type: 'spring', stiffness: 170, damping: 18}}>
              <div className="cond" style={{fontSize: '1.5vw', color: 'var(--ice-dim)', letterSpacing: '0.02em'}}>Generation {show.generation - 1} pays out</div>
              <div style={{fontSize: '7.2vw', lineHeight: 0.92, fontWeight: 850, fontVariationSettings: "'wdth' 125",
                background: 'linear-gradient(180deg, #FFE7A0 0%, #F2C230 45%, #E07B1F 100%)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent',
                filter: 'drop-shadow(0 0.4vw 1.6vw rgba(242,160,40,.35))'}}>Production</div>
            </motion.div>
          )}
        </AnimatePresence>
        <AnimatePresence>
          {showChips && (
            <motion.div key="chips" initial={{opacity: 0}} animate={{opacity: 1}} exit={{opacity: 0, y: 20}}
              style={{display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: '1vw', marginTop: '2.4vh'}}>
              {show.players.map((p, i) => <IncomeChip key={p.color} p={p} i={i} />)}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function IncomeChip({p, i}: {p: ProductionShow['players'][number]; i: number}) {
  const icon = Math.round(window.innerWidth * 0.013);
  const others = SHOW_RESOURCES.filter((r) => r !== 'megacredits' && p.gains[r] > 0);
  return (
    <motion.div initial={{opacity: 0, y: 26, scale: 0.8}} animate={{opacity: 1, y: 0, scale: 1}} transition={{delay: i * 0.12, type: 'spring', stiffness: 260, damping: 18}}
      style={{padding: '1vh 1.2vw', borderRadius: '1vw', background: 'rgba(12,5,3,.7)', backdropFilter: 'blur(10px)', boxShadow: `inset 0.3vw 0 0 ${PLAYER_HEX[p.color]}`, textAlign: 'left'}}>
      <div style={{fontSize: tvt(1.15), fontWeight: 700, color: PLAYER_HEX[p.color]}}>{p.name}</div>
      <div style={{display: 'flex', alignItems: 'center', gap: '0.5vw'}}>
        <ResIcon r="megacredits" size={Math.round(icon * 1.5)} />
        <span className="num" style={{fontSize: '2.6vw', color: 'var(--mc)'}}>+{p.gains.megacredits}</span>
      </div>
      {others.length > 0 && (
        <div style={{display: 'flex', gap: '0.7vw', marginTop: '0.4vh'}}>
          {others.map((r) => (
            <span key={r} style={{display: 'inline-flex', alignItems: 'center', gap: '0.2vw'}}>
              <ResIcon r={r} size={icon} /><span className="num" style={{fontSize: tvt(1.1)}}>+{p.gains[r]}</span>
            </span>
          ))}
        </div>
      )}
    </motion.div>
  );
}
