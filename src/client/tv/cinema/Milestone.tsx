// Terraforming milestones. A maxed global parameter gets a full-screen cinematic: the planet visibly
// changes (the lowlands flood, the air turns blue, the caps melt) under big type. Board bonus steps
// get a short banner instead.
import {motion} from 'motion/react';
import {Suspense, useEffect, useState} from 'react';
import {PLAYER_HEX, ResIcon} from '../../ui/Icons';
import {Planet} from '../Planet';
import type {Cinematic, MilestoneKind} from './queue';
import {tvt} from '../settings';
import {useDisplayName} from '../../names';

const TEXT: Record<MilestoneKind, {title: string; sub: string; accent: string}> = {
  oceans: {title: 'The last ocean', sub: 'All nine oceans are on Mars', accent: 'var(--ocean)'},
  oxygen: {title: 'Breathable air', sub: 'Oxygen reached 14%', accent: 'var(--plants)'},
  temperature: {title: 'A warm world', sub: 'Temperature reached +8 °C', accent: 'var(--heat)'},
  all: {title: 'Mars is terraformed', sub: 'Every global parameter is at its maximum. This is the final generation.', accent: 'var(--tr)'},
  'heat-bonus': {title: 'Heat production +1', sub: '', accent: 'var(--heat)'},
  'ocean-bonus': {title: 'Above freezing', sub: 'An ocean tile is placed', accent: 'var(--ocean)'},
  'oxygen-bonus': {title: 'Oxygen 8%', sub: 'Temperature rises one step', accent: 'var(--plants)'},
};

export function MilestoneCinematic({c}: {c: Extract<Cinematic, {kind: 'milestone'}>}) {
  return c.milestone.endsWith('bonus') ? <Beat c={c} /> : <Big c={c} />;
}

function Big({c}: {c: Extract<Cinematic, {kind: 'milestone'}>}) {
  const nameFor = useDisplayName();
  const txt = TEXT[c.milestone];
  // One step on the track is a small change on the globe, so the cinematic winds the milestone's own
  // parameter back a little before letting it wash across the planet.
  const from = {...c.planet.from};
  const back = (v: number) => Math.max(0, v - 0.4);
  if (c.milestone === 'oceans' || c.milestone === 'all') from.sea = back(c.planet.to.sea);
  if (c.milestone === 'oxygen' || c.milestone === 'all') from.green = back(c.planet.to.green);
  if (c.milestone === 'temperature' || c.milestone === 'all') from.warmth = back(c.planet.to.warmth);
  const [planet, setPlanet] = useState(from);
  useEffect(() => { const t = setTimeout(() => setPlanet(c.planet.to), 900); return () => clearTimeout(t); }, [c]);
  const all = c.milestone === 'all';
  return (
    <motion.div initial={{opacity: 0}} animate={{opacity: 1}} exit={{opacity: 0}} transition={{duration: 0.7}}
      style={{position: 'absolute', inset: 0, zIndex: 40, overflow: 'hidden', background: 'radial-gradient(90% 90% at 50% 55%, #1C1020, #07040A 70%)'}}>
      {all && <motion.div initial={{opacity: 0}} animate={{opacity: 0.45}} transition={{delay: 1.5, duration: 3}}
        style={{position: 'absolute', inset: 0, background: 'url(/assets/tv-stage-3.webp) center / cover', filter: 'blur(3px)'}} />}
      <Stars />
      {/* the planet swells in, then transforms */}
      <motion.div initial={{scale: 0.6, opacity: 0, y: '6vh'}} animate={{scale: 1, opacity: 1, y: 0}} transition={{duration: 1.4, ease: [0.2, 0.9, 0.25, 1]}}
        style={{position: 'absolute', left: '50%', top: '50%', width: '74vh', height: '74vh', marginLeft: '-37vh', marginTop: '-40vh'}}>
        <Suspense fallback={null}><Planet sea={planet.sea} green={planet.green} warmth={planet.warmth} rate={1.5} spin={all ? 0.35 : 0.12} /></Suspense>
      </motion.div>
      {/* a wave of light passes as the change happens */}
      <motion.div initial={{scale: 0.2, opacity: 0}} animate={{scale: [0.2, 1.6], opacity: [0, 0.55, 0]}} transition={{delay: 0.95, duration: 1.8, ease: 'easeOut'}}
        style={{position: 'absolute', left: '50%', top: '46%', width: '80vh', height: '80vh', marginLeft: '-40vh', marginTop: '-40vh', borderRadius: '50%',
          border: `0.6vh solid ${txt.accent}`, boxShadow: `0 0 6vh ${txt.accent}`}} />
      <div style={{position: 'absolute', left: 0, right: 0, bottom: '9vh', textAlign: 'center'}}>
        <motion.div initial={{opacity: 0, y: 30, letterSpacing: '0.3em', filter: 'blur(12px)'}} animate={{opacity: 1, y: 0, letterSpacing: '-0.01em', filter: 'blur(0px)'}}
          transition={{delay: 1.4, duration: 1, ease: [0.2, 0.9, 0.25, 1]}}
          style={{fontSize: all ? '7vw' : '6vw', fontWeight: 900, lineHeight: 0.95, fontVariationSettings: "'wdth' 124", color: txt.accent,
            textShadow: `0 0 5vw color-mix(in oklab, ${txt.accent} 45%, transparent)`}}>
          {txt.title}
        </motion.div>
        <motion.div initial={{opacity: 0}} animate={{opacity: 1}} transition={{delay: 2.1}} style={{fontSize: '1.7vw', color: 'var(--ice-dim)', marginTop: '1.6vh'}}>
          {txt.sub}
          {c.by && <> · <span style={{color: PLAYER_HEX[c.by.color], fontWeight: 700}}>{nameFor(c.by.color, c.by.name)}</span> made it happen</>}
        </motion.div>
      </div>
    </motion.div>
  );
}

function Beat({c}: {c: Extract<Cinematic, {kind: 'milestone'}>}) {
  const nameFor = useDisplayName();
  const txt = TEXT[c.milestone];
  const icon = c.milestone === 'heat-bonus' ? 'heat' : c.milestone === 'oxygen-bonus' ? 'plants' : null;
  const sub = c.milestone === 'heat-bonus' ? `Temperature ${c.value} °C` : txt.sub;
  return (
    <motion.div initial={{opacity: 0, y: -40, scale: 0.9}} animate={{opacity: 1, y: 0, scale: 1}} exit={{opacity: 0, y: -24}} transition={{type: 'spring', stiffness: 160, damping: 18}}
      style={{position: 'absolute', left: '50%', top: '4vh', transform: 'translateX(-50%)', zIndex: 41, display: 'flex', alignItems: 'center', gap: '1.2vw',
        padding: '1.6vh 2.4vw', borderRadius: '1.4vw', background: 'rgba(12,5,3,.78)', backdropFilter: 'blur(14px)',
        boxShadow: `0 0 0 1px var(--rim-strong), 0 0 4vw color-mix(in oklab, ${txt.accent} 30%, transparent)`}}>
      <motion.div animate={{rotate: [0, -12, 12, 0], scale: [1, 1.25, 1]}} transition={{duration: 0.9, delay: 0.2}}>
        {icon ? <ResIcon r={icon} size={Math.round(window.innerWidth * 0.03)} /> :
          <svg width={window.innerWidth * 0.03} height={window.innerWidth * 0.03} viewBox="0 0 24 24"><path d="M12 2.5C16 8 19 11.5 19 15a7 7 0 0 1-14 0c0-3.5 3-7 7-12.5z" fill="#2F82C0" /></svg>}
      </motion.div>
      <div>
        <div style={{fontSize: '2.6vw', fontWeight: 850, lineHeight: 1, fontVariationSettings: "'wdth' 118", color: txt.accent}}>{txt.title}</div>
        <div className="muted" style={{fontSize: tvt(1.2), marginTop: '0.5vh'}}>
          {sub}{c.by && <> · <span style={{color: PLAYER_HEX[c.by.color], fontWeight: 650}}>{nameFor(c.by.color, c.by.name)}</span></>}
        </div>
      </div>
    </motion.div>
  );
}

function Stars() {
  // A fixed field; twinkle is a slow opacity loop on two layers.
  const dots = Array.from({length: 90}, (_, i) => ({x: (i * 73.13) % 100, y: (i * 41.7 + (i % 7) * 13) % 100, r: (i % 5) * 0.4 + 0.6}));
  return (
    <>
      {[0, 1].map((layer) => (
        <motion.svg key={layer} viewBox="0 0 100 100" preserveAspectRatio="none" style={{position: 'absolute', inset: 0, width: '100%', height: '100%'}}
          animate={{opacity: layer ? [0.2, 0.7, 0.2] : [0.6, 0.25, 0.6]}} transition={{duration: 3 + layer, repeat: Infinity}}>
          {dots.filter((_, i) => i % 2 === layer).map((d, i) => <circle key={i} cx={d.x} cy={d.y} r={d.r * 0.08} fill="#EAF2F4" />)}
        </motion.svg>
      ))}
    </>
  );
}
