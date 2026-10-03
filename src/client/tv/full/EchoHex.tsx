// Map echo on the flat board: a glowing border that pulses round each space a phone asked about, for as long as the
// echo lasts (src/client/tv/full/echoStore.ts). Reduced motion: the same border, lit and still.
import {AnimatePresence, motion} from 'motion/react';
import {PLAYER_HEX} from '../../ui/Icons';
import {prefersReducedMotion} from '../../ui/tokens';
import {useEchoSpaces} from './echoStore';
import {HEX_R, hexPoints} from './geometry';

const OUTER = hexPoints(HEX_R + 4);
const INNER = hexPoints(HEX_R - 2);

/** Drawn inside the board's moving SVG layer, so it follows the camera like the tiles and the ghosts. */
export function FlatEchoes({pos}: {pos: Map<string, {cx: number; cy: number}>}) {
  const spaces = useEchoSpaces((s) => s.spaces);
  // read live: motion's hook keeps the value it had when the board mounted
  const reduced = prefersReducedMotion();
  return (
    <AnimatePresence>
      {spaces.filter((e) => pos.has(e.spaceId)).map((e) => {
        const c = pos.get(e.spaceId)!;
        const color = PLAYER_HEX[e.color as keyof typeof PLAYER_HEX] ?? '#F2C230';
        return (
          <motion.g key={e.key} data-echo={e.spaceId} transform={`translate(${c.cx} ${c.cy})`}
            initial={{opacity: 0}} animate={{opacity: 1}} exit={{opacity: 0, transition: {duration: 0.35}}} transition={{duration: reduced ? 0.15 : 0.25}}>
            {/* the glow: a wide soft stroke under a crisp one */}
            <motion.polygon points={OUTER} fill="none" stroke={color} strokeWidth={14} strokeLinejoin="round" style={{filter: 'blur(5px)'}}
              animate={reduced ? {opacity: 0.75} : {opacity: [0.35, 0.95, 0.35]}} transition={reduced ? {duration: 0} : {duration: 1, repeat: Infinity, ease: 'easeInOut'}} />
            <motion.polygon points={OUTER} fill="none" stroke="#FFF4E0" strokeWidth={3.5} strokeLinejoin="round"
              animate={reduced ? {opacity: 1} : {opacity: [0.7, 1, 0.7]}} transition={reduced ? {duration: 0} : {duration: 1, repeat: Infinity, ease: 'easeInOut'}} />
            <polygon points={INNER} fill={color} opacity={0.14} />
          </motion.g>
        );
      })}
    </AnimatePresence>
  );
}
