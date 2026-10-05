// Weather over the planet: a short dust storm after an attack and a soft late-game mist after an ocean.
// The storm is one 2D canvas of thin streaks with a capped count (and a haze layer); the mist is three soft
// bands moving by transform. Both stay faint so the board under them remains readable.
import {motion} from 'motion/react';
import {useEffect, useRef} from 'react';
import {qualityLevel} from '../full/board3d/quality';

export const STORM_MS = 2200;
export const MIST_MS = 4600;
/** Most streaks drawn in one storm, whatever the screen size. */
export const MAX_STREAKS = 150;

const FILL: React.CSSProperties = {position: 'absolute', inset: 0, pointerEvents: 'none'};
// soft round edge so weather stays over the planet, not the frame
const DISC_MASK = 'radial-gradient(circle at 50% 50%, #000 52%, transparent 64%)';

type Streak = {x: number; y: number; len: number; speed: number; drift: number; alpha: number; light: boolean; delay: number};

export function DustStorm({at, mode}: {at: number; mode: 'storm' | 'haze'}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (mode !== 'storm') return;
    const c = canvas.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    // a TV whose 3D board had to step its effects down (board3d/quality.ts) draws half the streaks at 1×
    const lean = !qualityLevel().effects;
    const dpr = lean ? 1 : Math.min(1.5, window.devicePixelRatio || 1);
    const w = c.clientWidth, h = c.clientHeight;
    c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const scale = h / 900;
    const n = Math.round(Math.min(MAX_STREAKS, Math.round((w * h) / 9000)) * (lean ? 0.5 : 1));
    // a deterministic spread per storm, so every TV draws the same weather for the same attack
    let seed = Math.floor(at) % 2147483647 || 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const streaks: Streak[] = Array.from({length: n}, () => ({
      x: -0.15 - rnd() * 0.5, y: 0.1 + rnd() * 0.8, len: (16 + rnd() * 46) * scale, speed: 0.55 + rnd() * 0.6,
      drift: (rnd() - 0.4) * 0.06, alpha: 0.12 + rnd() * 0.24, light: rnd() < 0.3, delay: rnd() * 0.25,
    }));
    let raf = 0;
    const t0 = performance.now();
    const frame = (now: number) => {
      const t = (now - t0) / STORM_MS;
      ctx.clearRect(0, 0, w, h);
      if (t >= 1) return;
      const env = Math.min(1, t / 0.15) * Math.min(1, (1 - t) / 0.3);
      ctx.lineCap = 'round';
      ctx.lineWidth = 1.6 * Math.max(1, scale);
      for (const s of streaks) {
        const p = Math.max(0, t - s.delay);
        const x = (s.x + p * s.speed * 1.7) * w;
        const y = (s.y + p * s.drift) * h;
        if (x < -s.len || x > w + s.len) continue;
        ctx.strokeStyle = s.light ? `rgba(242,206,168,${(s.alpha * env).toFixed(3)})` : `rgba(206,138,86,${(s.alpha * env).toFixed(3)})`;
        ctx.beginPath(); ctx.moveTo(x - s.len, y - s.len * 0.08); ctx.lineTo(x, y); ctx.stroke();
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [at, mode]);

  return (
    <div data-weather="storm" aria-hidden="true" style={{...FILL, maskImage: DISC_MASK, WebkitMaskImage: DISC_MASK}}>
      <motion.div initial={{opacity: 0, x: mode === 'storm' ? '-4%' : 0}} animate={{opacity: [0, 1, 1, 0], x: mode === 'storm' ? '4%' : 0}}
        transition={{duration: (mode === 'storm' ? STORM_MS : 1600) / 1000, times: [0, 0.18, 0.7, 1], ease: 'easeInOut'}}
        style={{...FILL, background: 'radial-gradient(ellipse 70% 55% at 42% 52%, rgba(196,122,70,.16), rgba(150,88,52,.07) 60%, transparent 82%)'}} />
      {mode === 'storm' && <canvas ref={canvas} style={{...FILL, width: '100%', height: '100%'}} />}
    </div>
  );
}

const BANDS = [
  {top: '18%', h: '26%', delay: 0, from: '-28%', to: '22%'},
  {top: '44%', h: '30%', delay: 0.5, from: '24%', to: '-20%'},
  {top: '66%', h: '22%', delay: 0.9, from: '-18%', to: '26%'},
];

export function Mist({at}: {at: number}) {
  return (
    <div data-weather="mist" data-at={at} aria-hidden="true" style={{...FILL, maskImage: DISC_MASK, WebkitMaskImage: DISC_MASK}}>
      {BANDS.map((b, i) => (
        <motion.div key={i} initial={{opacity: 0, x: b.from}} animate={{opacity: [0, 1, 1, 0], x: b.to}}
          transition={{duration: MIST_MS / 1000 - b.delay, delay: b.delay, times: [0, 0.25, 0.7, 1], ease: 'easeInOut'}}
          style={{position: 'absolute', left: '-10%', right: '-10%', top: b.top, height: b.h,
            background: 'radial-gradient(ellipse 50% 50% at 50% 50%, rgba(206,228,244,.12), rgba(206,228,244,.045) 55%, transparent 75%)'}} />
      ))}
    </div>
  );
}
