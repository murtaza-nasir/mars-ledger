// Odometer numerals: each digit is a column of 0-9 that springs to its place.
// A change also flashes a delta chip so the eye catches what moved.
import {AnimatePresence, motion} from 'motion/react';
import {useEffect, useRef, useState} from 'react';

function Digit({d, delay}: {d: number; delay: number}) {
  return (
    // sized by a hidden 0 in the same font (tabular digits are all that wide), and clipped above and below only, so
    // wide or heavy numerals never lose their sides
    <span style={{display: 'inline-block', height: '1em', position: 'relative', clipPath: 'inset(0 -0.4em)'}}>
      <span aria-hidden="true" style={{visibility: 'hidden', display: 'block', height: '1em', lineHeight: 1}}>0</span>
      <motion.span
        style={{display: 'flex', flexDirection: 'column', position: 'absolute', top: 0, left: 0, right: 0, textAlign: 'center'}}
        initial={false}
        animate={{y: `${-d}em`}}
        transition={{type: 'spring', stiffness: 170, damping: 22, mass: 0.9, delay}}
      >
        {Array.from({length: 10}, (_, i) => <span key={i} style={{height: '1em', lineHeight: 1}}>{i}</span>)}
      </motion.span>
    </span>
  );
}

/** `deltaTop`: where the delta chip sits, from the numerals' top (default just above them; a tight tile puts it
 *  beside the numerals, '0.32em', so it never runs into a label above). */
export function Rolling({value, className, style, showDelta = true, deltaTop = '-0.2em'}: {value: number; className?: string; style?: React.CSSProperties; showDelta?: boolean; deltaTop?: string}) {
  const prev = useRef(value);
  const [delta, setDelta] = useState<{n: number; k: number} | null>(null);
  useEffect(() => {
    if (value !== prev.current) {
      setDelta({n: value - prev.current, k: Date.now()});
      prev.current = value;
      const t = setTimeout(() => setDelta(null), 1600);
      return () => clearTimeout(t);
    }
  }, [value]);
  const neg = value < 0;
  const digits = String(Math.abs(value)).split('').map(Number);
  return (
    <span className={className} style={{position: 'relative', display: 'inline-flex', alignItems: 'flex-start', lineHeight: 1, ...style}} aria-label={String(value)} data-odometer="">
      {neg && <span style={{display: 'inline-block', height: '1em', lineHeight: 1}}>−</span>}
      {digits.map((d, i) => <Digit key={digits.length - i} d={d} delay={(digits.length - 1 - i) * 0.04} />)}
      <AnimatePresence>
        {showDelta && delta && (
          <motion.span
            key={delta.k}
            initial={{opacity: 0, y: 6, scale: 0.8}}
            animate={{opacity: 1, y: -2, scale: 1}}
            exit={{opacity: 0, y: -14}}
            transition={{duration: 0.35}}
            style={{position: 'absolute', left: '100%', top: deltaTop, marginLeft: 4, fontSize: '0.36em', fontWeight: 700,
              color: delta.n > 0 ? 'var(--plants)' : 'var(--ember)', whiteSpace: 'nowrap', fontVariationSettings: "'wdth' 90"}}
          >
            {delta.n > 0 ? '+' : '−'}{Math.abs(delta.n)}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}
