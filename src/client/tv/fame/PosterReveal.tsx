// The last card of the end sequence on the TV: the game's poster develops out of the dark, framed,
// with a line telling everyone where to save it. With a one-off illustration too, it follows halfway.
import {AnimatePresence, motion} from 'motion/react';
import {useEffect, useState} from 'react';
import {posterUrl} from '../../../shared/poster';
import type {PosterStatus, PosterVariant} from '../../../shared/poster';

export function PosterReveal({status, ms}: {status: PosterStatus; ms: number}) {
  const both = status.unique === 'ready';
  const [variant, setVariant] = useState<PosterVariant>('library');
  useEffect(() => {
    if (!both) return;
    const t = setTimeout(() => setVariant('unique'), ms / 2);
    return () => clearTimeout(t);
  }, [both, ms]);
  return (
    <div style={{position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: 'radial-gradient(80% 70% at 50% 45%, rgba(24,10,6,.6), rgba(6,2,1,.96))'}}>
      <div style={{display: 'grid', gap: '2.6vh', justifyItems: 'center'}}>
        <div style={{position: 'relative', width: 'min(82vw, 146vh)', aspectRatio: '16 / 9'}}>
          <AnimatePresence>
            <motion.img key={variant} src={posterUrl(status, variant, 'landscape')} alt="The poster of this game"
              initial={{opacity: 0, scale: 1.06, filter: 'blur(18px) brightness(.35) saturate(.5)'}}
              animate={{opacity: 1, scale: 1, filter: 'blur(0px) brightness(1) saturate(1)'}}
              exit={{opacity: 0, transition: {duration: 1.4}}}
              transition={{duration: 2.8, ease: [0.2, 0.9, 0.25, 1]}}
              style={{position: 'absolute', inset: 0, width: '100%', height: '100%', borderRadius: '0.6vw',
                boxShadow: '0 0 0 1px rgba(242,194,48,.45), 0 3vw 6vw rgba(0,0,0,.7)'}} />
          </AnimatePresence>
          {/* one slow light sweep as it settles */}
          <motion.div aria-hidden="true" key={`sweep-${variant}`} initial={{x: '-60%', opacity: 0}} animate={{x: '160%', opacity: [0, 0.5, 0]}}
            transition={{duration: 2.4, delay: 1.6, ease: 'easeInOut'}}
            style={{position: 'absolute', top: 0, bottom: 0, width: '30%', pointerEvents: 'none', borderRadius: '0.6vw',
              background: 'linear-gradient(100deg, transparent, rgba(255,236,200,.35), transparent)'}} />
        </div>
        <motion.div initial={{opacity: 0, y: 12}} animate={{opacity: 1, y: 0}} transition={{delay: 2.4, duration: 0.8}}
          style={{display: 'flex', alignItems: 'baseline', gap: '1.2vw'}}>
          <AnimatePresence mode="wait">
            <motion.span key={variant} initial={{opacity: 0}} animate={{opacity: 1}} exit={{opacity: 0}}
              style={{fontSize: '1.9vw', fontWeight: 800, fontVariationSettings: "'wdth' 105"}}>
              {variant === 'unique' ? 'The one-off illustration' : 'Your poster'}
            </motion.span>
          </AnimatePresence>
          <span className="muted" style={{fontSize: '1.4vw'}}>Keep it: tap Save the poster on your phone.</span>
        </motion.div>
      </div>
    </div>
  );
}
