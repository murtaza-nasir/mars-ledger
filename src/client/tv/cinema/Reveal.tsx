// Corporation reveal at game start: each corporation card sweeps in face down, flips,
// and its founder's name locks on; starting M€ and production pop in. One seat every 2.6 s.
import {AnimatePresence, motion} from 'motion/react';
import {useEffect, useState} from 'react';
import {findCard} from '../../../shared/cards';
import {PLAYER_HEX, ResIcon} from '../../ui/Icons';
import {Rolling} from '../../ui/Rolling';
import type {Resource} from '../../../shared/types';
import {CardArt} from './CardArt';
import {seatSeconds, type RevealSeat} from './queue';
import {TYPE_COLOR} from '../../ui/CardFace';
import {tvt} from '../settings';

const RES: Resource[] = ['megacredits', 'steel', 'titanium', 'plants', 'energy', 'heat'];

export function Reveal({seats, t}: {seats: RevealSeat[]; t: number}) {
  // Each founder holds the screen for their own length of time (preludes add a beat).
  let i = 0;
  for (let acc = 0.4; i < seats.length - 1 && t >= acc + seatSeconds(seats[i]); i++) acc += seatSeconds(seats[i]);
  const seat = seats[i];
  return (
    <motion.div initial={{opacity: 0}} animate={{opacity: 1}} exit={{opacity: 0}} transition={{duration: 0.5}}
      style={{position: 'absolute', inset: 0, zIndex: 40, overflow: 'hidden'}}>
      <div style={{position: 'absolute', inset: 0, background: 'url(/assets/tv-stage-0.webp) center / cover', filter: 'brightness(.35) blur(4px)', transform: 'scale(1.05)'}} />
      <div style={{position: 'absolute', inset: 0, background: 'radial-gradient(70% 70% at 35% 50%, transparent, rgba(12,5,3,.9))'}} />
      <div className="cond" style={{position: 'absolute', top: '5vh', left: '6vw', fontSize: '1.4vw', color: 'var(--ice-dim)', letterSpacing: '0.04em'}}>
        The corporations of Mars · {i + 1} of {seats.length}
      </div>
      <div style={{position: 'absolute', top: '5vh', right: '6vw', display: 'flex', gap: '0.6vw'}}>
        {seats.map((s, k) => (
          <motion.span key={s.color} animate={{width: k === i ? '3vw' : '0.9vw', opacity: k <= i ? 1 : 0.3}}
            style={{height: '0.9vw', borderRadius: 999, background: PLAYER_HEX[s.color]}} />
        ))}
      </div>
      <AnimatePresence mode="popLayout">
        <Seat key={seat.color} seat={seat} />
      </AnimatePresence>
    </motion.div>
  );
}

function Seat({seat}: {seat: RevealSeat}) {
  const def = findCard(seat.corporation);
  const color = PLAYER_HEX[seat.color] ?? '#F2C230';
  const [shown, setShown] = useState(false);
  useEffect(() => { const t = setTimeout(() => setShown(true), 900); return () => clearTimeout(t); }, []);
  const prod = RES.filter((r) => (seat.production[r] ?? 0) !== 0);
  return (
    <motion.div style={{position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6vw', padding: '6vh 7vw 0'}}
      exit={{opacity: 0, x: '18vw', scale: 0.85, filter: 'blur(8px)'}} transition={{duration: 0.45, ease: [0.5, 0, 0.75, 0]}}>
      {/* the card: face down, sweeps in, flips */}
      <motion.div initial={{x: '-40vw', rotateZ: -18, rotateY: 180, scale: 0.8}} animate={{x: 0, rotateZ: -4, rotateY: 0, scale: 1}}
        transition={{x: {type: 'spring', stiffness: 70, damping: 15}, rotateZ: {type: 'spring', stiffness: 60, damping: 12}, rotateY: {delay: 0.35, duration: 0.7, ease: [0.3, 0.7, 0.3, 1]}, scale: {duration: 0.8}}}
        style={{position: 'relative', flexShrink: 0, height: '72vh', aspectRatio: '5 / 7', transformStyle: 'preserve-3d', perspective: 1200}}>
        <div style={{position: 'absolute', inset: 0, backfaceVisibility: 'hidden', borderRadius: '1.4vw', overflow: 'hidden', background: 'linear-gradient(170deg, #3A2A26, #1A0D0A)',
          boxShadow: `0 0 0 0.2vw ${color}, 0 3vw 7vw rgba(0,0,0,.65), 0 0 6vw color-mix(in oklab, ${color} 35%, transparent)`}}>
          <CardArt name={seat.corporation} style={{height: '46%'}} />
          <div style={{padding: '1.6vw 1.8vw'}}>
            <div style={{fontSize: '2.5vw', fontWeight: 850, lineHeight: 1, fontVariationSettings: "'wdth' 92"}}>{seat.corporation}</div>
            <div style={{fontSize: tvt(1.25), lineHeight: 1.45, marginTop: '1.6vh', color: 'var(--ice-dim)'}}>{def?.description ?? def?.text.join(' ')}</div>
          </div>
          {/* sheen sweeping across once the card is face up */}
          <motion.div initial={{x: '-120%'}} animate={{x: '140%'}} transition={{delay: 1, duration: 1.1, ease: 'easeInOut'}}
            style={{position: 'absolute', inset: 0, background: 'linear-gradient(105deg, transparent 35%, rgba(255,240,220,.28) 50%, transparent 65%)'}} />
        </div>
        <div style={{position: 'absolute', inset: 0, backfaceVisibility: 'hidden', transform: 'rotateY(180deg)', borderRadius: '1.4vw',
          background: 'radial-gradient(circle at 50% 42%, #C1502B, #5A1F12 55%, #1A0D0A)', boxShadow: '0 3vw 7vw rgba(0,0,0,.65), inset 0 0 0 0.5vw rgba(255,196,160,.2)',
          display: 'grid', placeItems: 'center'}}>
          <div style={{fontSize: '6vw', fontWeight: 900, fontVariationSettings: "'wdth' 125", color: 'rgba(255,220,190,.55)'}}>M</div>
        </div>
      </motion.div>

      {/* the founder */}
      <div style={{flex: 1, minWidth: 0, maxWidth: '52vw'}}>
        <motion.div initial={{opacity: 0, letterSpacing: '0.5em', filter: 'blur(10px)'}} animate={{opacity: 1, letterSpacing: '-0.01em', filter: 'blur(0px)'}}
          transition={{delay: 0.55, duration: 0.8, ease: [0.2, 0.9, 0.25, 1]}}
          style={{fontSize: '7vw', lineHeight: 0.95, fontWeight: 900, fontVariationSettings: "'wdth' 120", color, textShadow: `0 0 4vw color-mix(in oklab, ${color} 40%, transparent)`}}>
          {seat.name}
        </motion.div>
        <motion.div initial={{scaleX: 0}} animate={{scaleX: 1}} transition={{delay: 0.9, duration: 0.6, ease: [0.2, 0.9, 0.25, 1]}}
          style={{height: '0.35vw', width: '22vw', background: color, transformOrigin: 'left', margin: '2vh 0'}} />
        <motion.div initial={{opacity: 0, y: 12}} animate={{opacity: 1, y: 0}} transition={{delay: 1}} style={{fontSize: '2.4vw', color: 'var(--ice-dim)'}}>
          founds <span style={{color: 'var(--ice)', fontWeight: 750}}>{seat.corporation}</span>
        </motion.div>
        <motion.div initial={{opacity: 0, y: 20}} animate={{opacity: 1, y: 0}} transition={{delay: 1.15, type: 'spring', stiffness: 120}}
          style={{display: 'flex', alignItems: 'center', gap: '1vw', marginTop: '4vh'}}>
          <ResIcon r="megacredits" size={Math.round(window.innerWidth * 0.03)} />
          <Rolling value={shown ? seat.megacredits : 0} className="num" style={{fontSize: '6vw', color: 'var(--mc)'}} showDelta={false} />
          <span className="cond" style={{fontSize: '1.7vw', color: 'var(--ice-dim)'}}>M€ in the bank</span>
        </motion.div>
        <div style={{display: 'flex', gap: '1vw', marginTop: '2.4vh', flexWrap: 'wrap'}}>
          {prod.map((r, k) => (
            <motion.span key={r} initial={{opacity: 0, scale: 0.4, y: 14}} animate={{opacity: 1, scale: 1, y: 0}} transition={{delay: 1.35 + k * 0.1, type: 'spring', stiffness: 260, damping: 14}}
              style={{display: 'inline-flex', alignItems: 'center', gap: '0.5vw', padding: '0.8vh 1.1vw', borderRadius: 999, background: 'rgba(176,122,69,.2)',
                boxShadow: 'inset 0 0 0 0.12vw rgba(176,122,69,.6)', fontSize: '1.6vw'}}>
              <ResIcon r={r} size={Math.round(window.innerWidth * 0.018)} />
              <span className="num">{(seat.production[r] ?? 0) > 0 ? '+' : ''}{seat.production[r]}</span>
              <span className="cond faint" style={{fontSize: tvt(1.1)}}>production</span>
            </motion.span>
          ))}
        </div>
        {seat.preludes?.length ? (
          <div style={{marginTop: '3.4vh'}}>
            <motion.div className="cond" initial={{opacity: 0}} animate={{opacity: 1}} transition={{delay: 1.7}}
              style={{fontSize: '1.4vw', color: 'var(--ice-dim)', marginBottom: '1.2vh'}}>with the preludes</motion.div>
            <div style={{display: 'flex', gap: '1.4vw'}}>
              {seat.preludes.map((n, k) => <PreludeChip key={n} name={n} k={k} />)}
            </div>
          </div>
        ) : null}
      </div>
    </motion.div>
  );
}

/** A prelude card, small: art, amber name band, one line of its effect. Sweeps up and settles with a slight fan. */
function PreludeChip({name, k}: {name: string; k: number}) {
  const def = findCard(name);
  const amber = TYPE_COLOR.prelude;
  return (
    <motion.div initial={{opacity: 0, y: '10vh', rotate: k ? 8 : -8, scale: 0.85}} animate={{opacity: 1, y: 0, rotate: k ? 1.5 : -1.5, scale: 1}}
      transition={{delay: 1.8 + k * 0.28, type: 'spring', stiffness: 110, damping: 14}}
      style={{width: '15vw', borderRadius: '0.9vw', overflow: 'hidden', background: 'linear-gradient(170deg, #3A2A26, #1A0D0A)',
        boxShadow: `0 0 0 0.16vw ${amber}, 0 2vw 4vw rgba(0,0,0,.55)`}}>
      <CardArt name={name} style={{height: '8.4vw'}} />
      <div style={{padding: '0.7vw 0.9vw 0.9vw', background: `linear-gradient(180deg, color-mix(in oklab, ${amber} 26%, transparent), transparent 60%)`}}>
        <div style={{fontSize: '1.3vw', fontWeight: 800, lineHeight: 1.05, fontVariationSettings: "'wdth' 88"}}>{name}</div>
        <div style={{fontSize: tvt(0.9), lineHeight: 1.35, marginTop: '0.5vh', color: 'var(--ice-dim)', display: '-webkit-box', WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical', overflow: 'hidden'}}>{def?.description ?? def?.text.join(' ')}</div>
      </div>
    </motion.div>
  );
}
