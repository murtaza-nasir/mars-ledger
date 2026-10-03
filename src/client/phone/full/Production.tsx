// The production show on a phone. As the TV's tokens fly out of the screen, they pour in from
// above the top edge, fall and land in this player's resource tiles, ticking each number up.
// It depends only on the show message: numbers hold at the pre-production value and end exactly
// on before + gains, which is what the engine's post-production model says.
import {AnimatePresence, motion} from 'motion/react';
import {useEffect, useMemo, useRef, useState} from 'react';
import {create} from 'zustand';
import type {ProductionShow} from '../../../shared/full';
import {SHOW_RESOURCES, tokenValues} from '../../../shared/production';
import type {Resource} from '../../../shared/types';
import {useNet} from '../../net';
import {heldValue} from '../../../shared/sync';
import {RES_LABEL, ResIcon} from '../../ui/Icons';
import {clamp01, drawSpark, drawToken, easeInCubic, easeOutCubic, fitCanvas, hashString, preloadTokens, prefersReducedMotion, rng, TOKEN_HEX} from '../../ui/tokens';

type Mine = ProductionShow['players'][number];

/** Seconds from the show's start. Tokens enter as they leave the TV (T.flyOut there is 1.95). */
const P = {enter: 1.9, bannerIn: 3.95, bannerOut: 6.1, end: 6.8};

/** `until`: the hold's hard deadline (local ms). Past it the tiles show the latest view, however late a timer fires. */
type ShowDisplay = {active: boolean; display: Record<Resource, number> | null; until: number; pulse: Record<Resource, number>};
export const useShowDisplay = create<ShowDisplay>(() => ({active: false, display: null, until: 0, pulse: {megacredits: 0, steel: 0, titanium: 0, plants: 0, energy: 0, heat: 0}}));

/** The number a resource tile shows while the show holds it (undefined: the latest view's number). */
export function useHeldNumber(r: Resource): number | undefined {
  return useShowDisplay((s) => heldValue(s.display ? {display: s.display, until: s.until} : null, Date.now())?.[r]);
}

/** Let go of the hold once its deadline has passed. Timers can fire late or never (a frozen or hidden page), so this
 *  also runs whenever the page comes back and whenever a new view arrives. */
export function releaseDueHold(now = Date.now()) {
  const s = useShowDisplay.getState();
  if ((s.active || s.display) && now >= s.until) useShowDisplay.setState({active: false, display: null});
}
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => releaseDueHold());
  window.addEventListener('focus', () => releaseDueHold());
  useNet.subscribe((s, prev) => { if (s.fullView !== prev.fullView) releaseDueHold(); });
}

type Drop = {kind: Resource | 'flame'; res: Resource; value: number; x0: number; y0: number; land: number; dur: number; size: number; spin: number; arc?: {x: number; y: number}};
type Spark = {x: number; y: number; vx: number; vy: number; t0: number; life: number; color: string; size: number};

const MAX_PER_RES: Record<Resource, number> = {megacredits: 14, steel: 6, titanium: 6, plants: 6, energy: 5, heat: 6};
const START: Record<Resource, number> = {megacredits: 0, steel: 0.45, titanium: 0.6, plants: 0.75, energy: 0.95, heat: 1.1};

function tileCenter(r: Resource): {x: number; y: number; w: number} {
  const el = document.querySelector(`[data-res-tile="${r}"]`);
  const b = el?.getBoundingClientRect();
  return b ? {x: b.left + b.width / 2, y: b.top + b.height * 0.62, w: b.width} : {x: window.innerWidth / 2, y: 120, w: 100};
}

function plan(me: Mine, id: string, w: number) {
  const r = rng(hashString(id + me.color));
  const drops: Drop[] = [];
  for (const res of SHOW_RESOURCES) {
    const amount = res === 'heat' ? me.gains.heat - me.energyToHeat : me.gains[res];
    const vals = tokenValues(amount, MAX_PER_RES[res]);
    const tile = tileCenter(res);
    vals.forEach((value, k) => {
      drops.push({kind: res, res, value, x0: tile.x + (r() - 0.5) * w * 0.9, y0: -60 - r() * 160,
        land: P.enter + START[res] + 0.35 + (k / Math.max(1, vals.length)) * (res === 'megacredits' ? 1.05 : 0.55) + r() * 0.08,
        dur: 0.55 + r() * 0.2, size: 30 + r() * 6, spin: (r() - 0.5) * 8});
    });
  }
  // energy on hand turns to heat: bolts leave the energy tile, arc over and fall into heat as flames
  const e = tileCenter('energy');
  const h = tileCenter('heat');
  tokenValues(me.energyToHeat, 5).forEach((value, k) => {
    drops.push({kind: 'flame', res: 'heat', value, x0: e.x, y0: e.y, land: P.enter + 0.25 + k * 0.16 + 0.75, dur: 0.75, size: 30, spin: 0,
      arc: {x: (e.x + h.x) / 2, y: Math.min(e.y, h.y) - 120}});
  });
  return drops.sort((a, b) => a.land - b.land);
}

export function ProductionShowPhone({playerId, color}: {playerId: string; color: string}) {
  const show = useNet((s) => s.production);
  const me = useMemo(() => show?.players.find((p) => p.playerId === playerId) ?? show?.players.find((p) => p.color === color), [show, playerId, color]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [t, setT] = useState(-1);
  const live = !!show && !!me && Date.now() < show.localStart + show.durationMs;
  const reduced = useMemo(prefersReducedMotion, []);

  // hold numbers from the moment the show arrives until it ends
  useEffect(() => {
    if (!show || !me) return;
    const endAt = show.localStart + show.durationMs;
    if (Date.now() > endAt) return;
    preloadTokens();
    window.scrollTo({top: 0, behavior: 'smooth'});
    const start = {...me.before};
    useShowDisplay.setState({active: true, display: start, until: endAt});
    setT((Date.now() - show.localStart) / 1000);
    const tick = setInterval(() => setT((Date.now() - show.localStart) / 1000), 100);
    const done = setTimeout(() => {
      useShowDisplay.setState({active: false, display: null});
      setT(P.end + 1);
    }, endAt - Date.now());
    return () => { clearInterval(tick); clearTimeout(done); useShowDisplay.setState({active: false, display: null}); };
  }, [show, me]);

  // the canvas choreography, and the numbers it ticks
  useEffect(() => {
    if (!show || !me || reduced) return;
    const c = canvas.current;
    if (!c) return;
    let raf = 0;
    let drops: Drop[] | null = null;
    const landed = new Set<number>();
    const left = new Set<number>();
    const sparks: Spark[] = [];
    const r = rng(hashString(show.id) + 7);
    let lastBuzz = 0;
    const buzz = (ms: number | number[]) => {
      const n = Date.now();
      if (n - lastBuzz < 90) return;
      lastBuzz = n;
      navigator.vibrate?.(ms);
    };
    const burst = (x: number, y: number, color: string, count: number, t0: number, speed = 260) => {
      for (let k = 0; k < count; k++) {
        const a = r() * Math.PI * 2;
        const s = speed * (0.4 + r());
        sparks.push({x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 60, t0, life: 0.45 + r() * 0.35, color, size: 1.5 + r() * 2});
      }
    };
    let bannerBurst = false;
    const loop = () => {
      const {ctx, w, h} = fitCanvas(c);
      const t = (Date.now() - show.localStart) / 1000;
      if (!drops && t >= P.enter - 0.2) drops = plan(me, show.id, w);
      ctx.clearRect(0, 0, w, h);
      if (drops) {
        // past the deadline the hold is gone: never bring it back from a late frame
        if (Date.now() >= useShowDisplay.getState().until) { if (t < P.end) raf = requestAnimationFrame(loop); return; }
        const disp = {...(useShowDisplay.getState().display ?? me.before)};
        let changed = false;
        drops.forEach((d, i) => {
          const start = d.land - d.dur;
          // an energy bolt leaving its tile takes one off the energy count
          if (d.arc && t >= start && !left.has(i)) { left.add(i); disp.energy = Math.max(0, disp.energy - d.value); changed = true; }
          if (t >= d.land && !landed.has(i)) {
            landed.add(i);
            disp[d.res] += d.value;
            changed = true;
            const tile = tileCenter(d.res);
            burst(tile.x, tile.y - 6, TOKEN_HEX[d.kind], d.res === 'megacredits' ? 6 : 8, t);
            useShowDisplay.setState((s) => ({pulse: {...s.pulse, [d.res]: Date.now()}}));
            buzz(8);
          }
          if (t < start || t >= d.land) return;
          const k = clamp01((t - start) / d.dur);
          const tile = tileCenter(d.res);
          let x: number; let y: number; let size: number; let vx: number; let vy: number;
          if (d.arc) {
            // quadratic arc from energy to heat
            const e = easeOutCubic(k);
            const ix = (1 - e) * d.x0 + e * d.arc.x; const iy = (1 - e) * d.y0 + e * d.arc.y;
            const jx = (1 - e) * d.arc.x + e * tile.x; const jy = (1 - e) * d.arc.y + e * tile.y;
            x = (1 - e) * ix + e * jx; y = (1 - e) * iy + e * jy;
            size = d.size * (0.8 + 0.5 * Math.sin(k * Math.PI));
            vx = (jx - ix) * 3; vy = (jy - iy) * 3;
            const flick = 0.85 + 0.15 * Math.sin(t * 38 + i);
            if (k < 0.55) drawToken(ctx, 'energy', x, y, size, t * 6, 1, vx, vy);
            else drawToken(ctx, 'flame', x, y, size * flick, 0, 1, vx, vy);
            return;
          }
          // from beyond the top edge: big and blurred, sharpening and settling into the tile
          const e = easeInCubic(k) * 0.55 + easeOutCubic(k) * 0.45;
          x = d.x0 + (tile.x - d.x0) * easeOutCubic(k);
          y = d.y0 + (tile.y - d.y0) * e;
          size = d.size * (1 + 2.6 * (1 - easeOutCubic(k)));
          vx = (tile.x - d.x0) * 1.5;
          vy = (tile.y - d.y0) * (1 - k) * 4;
          drawToken(ctx, d.kind, x, y, size, d.spin * (1 - k), clamp01(k * 4), vx, vy);
        });
        if (changed) useShowDisplay.setState({display: disp});
      }
      if (!bannerBurst && t >= P.bannerIn) {
        bannerBurst = true;
        const colors = SHOW_RESOURCES.filter((res) => me.gains[res] > 0).map((res) => TOKEN_HEX[res]);
        for (let k = 0; k < 70; k++) burst(w / 2, h * 0.52, colors[k % Math.max(1, colors.length)] ?? '#F2C230', 1, t + r() * 0.1, 420);
        navigator.vibrate?.([30, 50, 30]);
      }
      ctx.globalCompositeOperation = 'lighter';
      for (const s of sparks) {
        const st = t - s.t0;
        if (st < 0 || st > s.life) continue;
        drawSpark(ctx, s.x + s.vx * st, s.y + s.vy * st + 300 * st * st, s.vx, s.vy + 600 * st, s.size, s.color, 1 - st / s.life);
      }
      ctx.globalCompositeOperation = 'source-over';
      if (t < P.end) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [show, me, reduced]);

  // reduced motion: count straight to the result when the TV releases the tokens
  useEffect(() => {
    if (!reduced || !show || !me || t < P.enter) return;
    const after = {...me.before};
    for (const res of SHOW_RESOURCES) after[res] = me.before[res] + me.gains[res];
    after.energy = me.before.energy - me.energyToHeat + me.gains.energy;
    if (Date.now() < useShowDisplay.getState().until) useShowDisplay.setState({display: after});
  }, [reduced, show, me, t]);

  if (!show || !me || !live) return null;
  const parts = SHOW_RESOURCES.filter((r) => me.gains[r] > 0);
  return (
    <div style={{position: 'fixed', inset: 0, zIndex: 85, pointerEvents: 'none'}}>
      {/* the pre-roll: light gathering at the top edge, where the TV is */}
      <AnimatePresence>
        {t < P.enter + 1.4 && (
          <motion.div key="glow" initial={{opacity: 0}} animate={{opacity: t < P.enter ? 0.55 + 0.45 * clamp01(t / P.enter) : 1}} exit={{opacity: 0}} transition={{duration: 0.4}}
            style={{position: 'absolute', left: 0, right: 0, top: 0, height: 180, background: 'radial-gradient(70% 100% at 50% 0%, rgba(242,194,48,.55), rgba(242,194,48,0) 70%)'}} />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {t >= 0 && t < P.enter + 0.2 && (
          <motion.div key="incoming" initial={{opacity: 0, y: -10}} animate={{opacity: 1, y: 0}} exit={{opacity: 0, y: -16}}
            style={{position: 'absolute', top: 'calc(6px + env(safe-area-inset-top))', left: 0, right: 0, display: 'flex', justifyContent: 'center'}}>
            <motion.span animate={{scale: [1, 1.05, 1]}} transition={{duration: 0.9, repeat: Infinity}}
              style={{padding: '5px 14px', borderRadius: 999, background: 'var(--mc)', color: '#2A1A04', fontWeight: 750, fontVariationSettings: "'wdth' 105", fontSize: 14,
                boxShadow: '0 6px 24px rgba(242,194,48,.45)'}}>Production incoming</motion.span>
          </motion.div>
        )}
      </AnimatePresence>
      <canvas ref={canvas} style={{position: 'absolute', inset: 0, width: '100%', height: '100%'}} />
      <AnimatePresence>
        {t >= P.bannerIn && t < P.bannerOut && (
          <motion.div key="banner" role="status" aria-live="polite"
            initial={{opacity: 0, scale: 0.7, y: 20}} animate={{opacity: 1, scale: 1, y: 0}} exit={{opacity: 0, scale: 1.08, y: -20}}
            transition={{type: 'spring', stiffness: 280, damping: 20}}
            style={{position: 'absolute', left: 16, right: 16, top: '44%', padding: '18px 18px 16px', borderRadius: 24, textAlign: 'center',
              background: 'linear-gradient(180deg, rgba(58,36,14,.94), rgba(30,14,9,.96))', boxShadow: '0 0 0 1.5px rgba(242,194,48,.55), 0 30px 60px rgba(0,0,0,.55), 0 0 60px rgba(242,194,48,.25)'}}>
            <div className="cond" style={{fontSize: 14, color: 'var(--ice-dim)'}}>Generation {show.generation - 1} production</div>
            <div className="num" style={{fontSize: 52, color: 'var(--mc)', margin: '2px 0 6px'}}>+{me.gains.megacredits} <span style={{fontSize: 26}}>M€</span></div>
            <div style={{display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: '6px 14px'}}>
              {parts.filter((r) => r !== 'megacredits').map((r, i) => (
                <motion.span key={r} initial={{opacity: 0, y: 8}} animate={{opacity: 1, y: 0}} transition={{delay: 0.15 + i * 0.07}}
                  style={{display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 16}}>
                  <ResIcon r={r} size={18} /><span className="num" style={{fontSize: 18}}>+{me.gains[r]}</span><span className="muted">{RES_LABEL[r].toLowerCase()}</span>
                </motion.span>
              ))}
            </div>
            {me.energyToHeat > 0 && <div className="muted" style={{fontSize: 13, marginTop: 6}}>{me.energyToHeat} energy turned into heat</div>}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Tile pop when a token lands. */
export function useTilePulse(r: Resource) {
  return useShowDisplay((s) => s.pulse[r]);
}

