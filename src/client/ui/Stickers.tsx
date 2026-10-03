// The eight reaction stickers, drawn for this app. One system for all of them: a 100-unit disc with a
// two-stop gradient and a soft top sheen, glyphs in a dark ink line of ~4.5 units with round joins,
// light fills in warm white. `animated` adds a small idle loop (the TV shows them large).
import {motion} from 'motion/react';
import type {TargetAndTransition} from 'motion/react';
import type {ReactNode} from 'react';
import {useId} from 'react';
import type {StickerId} from '../../shared/reactions';
import {STICKER_LABEL} from '../../shared/reactions';

const INK = '#1A0D0A';
const CREAM = '#FFF4E6';
const W = 4.5;

type Look = {from: string; to: string; glyph: (a: boolean) => ReactNode};

const spin = (a: boolean, anim: TargetAndTransition, dur: number, origin = 'center') => (a ? {animate: anim, transition: {duration: dur, repeat: Infinity, ease: 'easeInOut' as const}, style: {transformBox: 'fill-box' as const, transformOrigin: origin}} : {});

function burst(cx: number, cy: number, ro: number, ri: number, n: number): string {
  const pts: string[] = [];
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 ? ri : ro;
    const a = (Math.PI * i) / n - Math.PI / 2;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(' ');
}

const sparkle = (x: number, y: number, r: number) => `M${x} ${y - r} Q${x} ${y} ${x + r} ${y} Q${x} ${y} ${x} ${y + r} Q${x} ${y} ${x - r} ${y} Q${x} ${y} ${x} ${y - r}Z`;

const LOOKS: Record<StickerId, Look> = {
  ouch: {from: '#F07A52', to: '#B8321A', glyph: (a) => (
    <motion.g {...spin(a, {scale: [1, 1.07, 1], rotate: [0, 6, 0]}, 1.1)}>
      <polygon points={burst(50, 50, 31, 16, 9)} fill="#FFE3B0" stroke={INK} strokeWidth={W} strokeLinejoin="round" />
      <path d="M50 38 V53" stroke={INK} strokeWidth={6} strokeLinecap="round" />
      <circle cx="50" cy="61" r="3.6" fill={INK} />
    </motion.g>
  )},
  nice: {from: '#7ED68A', to: '#3E9A4C', glyph: (a) => (
    <motion.g {...spin(a, {rotate: [-5, 4, -5], y: [0, -2, 0]}, 1.4, '30% 90%')}>
      <rect x="24" y="50" width="13" height="28" rx="3" fill={CREAM} stroke={INK} strokeWidth={W} strokeLinejoin="round" />
      <path d="M40 50 L49 30 C51 24 58 24 59.5 29.5 C60.5 33 59.5 37 58.2 41 L56.5 47 H70 C76 47 78.5 52 77.4 56.5 L73.5 72 C72.6 76 69.4 78 65.5 78 H40 Z"
        fill={CREAM} stroke={INK} strokeWidth={W} strokeLinejoin="round" />
      <path d="M58 58 H74 M58 67 H72" stroke={INK} strokeWidth={3.4} strokeLinecap="round" />
    </motion.g>
  )},
  meteor: {from: '#3A2F66', to: '#15112A', glyph: (a) => (
    <g>
      {[[26, 26], [36, 18], [78, 70], [72, 80]].map(([x, y], i) => (
        <motion.circle key={i} cx={x} cy={y} r={1.7} fill={CREAM} {...(a ? {animate: {opacity: [0.3, 1, 0.3]}, transition: {duration: 1.6, delay: i * 0.4, repeat: Infinity}} : {})} />
      ))}
      <motion.g {...(a ? {animate: {opacity: [0.75, 1, 0.8]}, transition: {duration: 0.35, repeat: Infinity}} : {})}>
        <path d="M54 46 L22 78" stroke="#F0643A" strokeWidth={10} strokeLinecap="round" opacity={0.9} />
        <path d="M58 52 L33 80" stroke="#F2C230" strokeWidth={5} strokeLinecap="round" />
        <path d="M50 41 L21 62" stroke="#FFD9A0" strokeWidth={4} strokeLinecap="round" />
      </motion.g>
      <motion.g {...spin(a, {rotate: [0, 360]}, 6)}>
        <circle cx="62" cy="38" r="14" fill="#8A5A3C" stroke={INK} strokeWidth={W} />
        <circle cx="58" cy="34" r="3.2" fill="#6A4028" />
        <circle cx="67" cy="42" r="2.6" fill="#6A4028" />
        <circle cx="65" cy="31" r="1.6" fill="#6A4028" />
      </motion.g>
    </g>
  )},
  greenery: {from: '#4FA36A', to: '#1F6B45', glyph: (a) => (
    <g>
      <polygon points="50,18 76,33 76,63 50,78 24,63 24,33" fill="none" stroke={CREAM} strokeWidth={3} strokeLinejoin="round" opacity={0.35} />
      <path d="M50 78 V56" stroke={INK} strokeWidth={W} strokeLinecap="round" />
      <motion.g {...spin(a, {rotate: [-6, 5, -6]}, 2.2, '100% 100%')}>
        <path d="M50 68 C37 67 29 57 30 43 C42 43 50 52 50 64 Z" fill="#B6F0A0" stroke={INK} strokeWidth={W} strokeLinejoin="round" />
      </motion.g>
      <motion.g {...spin(a, {rotate: [5, -5, 5]}, 2.2, '0% 100%')}>
        <path d="M50 62 C51 49 60 39 73 38 C74 51 66 61 50 62 Z" fill="#D8F7B8" stroke={INK} strokeWidth={W} strokeLinejoin="round" />
      </motion.g>
      <path d="M36 78 H64" stroke={INK} strokeWidth={W} strokeLinecap="round" />
    </g>
  )},
  money: {from: '#F7D25A', to: '#D49A12', glyph: (a) => (
    <g>
      <motion.path d={sparkle(76, 27, 7)} fill={CREAM} {...(a ? {animate: {scale: [0.6, 1.1, 0.6], opacity: [0.5, 1, 0.5]}, transition: {duration: 1.2, repeat: Infinity}, style: {transformBox: 'fill-box', transformOrigin: 'center'}} : {})} />
      <motion.path d={sparkle(26, 33, 5)} fill={CREAM} {...(a ? {animate: {scale: [1, 0.6, 1], opacity: [1, 0.5, 1]}, transition: {duration: 1.2, repeat: Infinity}, style: {transformBox: 'fill-box', transformOrigin: 'center'}} : {})} />
      <motion.g {...(a ? {animate: {scaleX: [1, 1, 0.12, 1, 1]}, transition: {duration: 2.6, times: [0, 0.55, 0.7, 0.85, 1], repeat: Infinity}, style: {transformBox: 'fill-box', transformOrigin: 'center'}} : {})}>
        <circle cx="50" cy="53" r="23" fill="#FFE58A" stroke={INK} strokeWidth={W} />
        <circle cx="50" cy="53" r="16.5" fill="none" stroke="#C8901A" strokeWidth={2.5} />
        <path d="M40.5 63 V44 L50 53.5 L59.5 44 V63" fill="none" stroke={INK} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" />
      </motion.g>
    </g>
  )},
  laugh: {from: '#BE82E8', to: '#7A3DB0', glyph: (a) => (
    <motion.g {...spin(a, {y: [0, -3, 0, -2, 0], rotate: [-3, 3, -3]}, 0.9)}>
      <path d="M30 45 Q36.5 36 43 45 M57 45 Q63.5 36 70 45" fill="none" stroke={INK} strokeWidth={W} strokeLinecap="round" />
      <path d="M29 54 H71 Q69 77 50 77 Q31 77 29 54 Z" fill={INK} stroke={INK} strokeWidth={2} strokeLinejoin="round" />
      <path d="M39 70 Q50 62 61 70 Q57 76 50 76 Q43 76 39 70 Z" fill="#FF7A8A" />
      <path d="M22 48 q-4 7 0 9 q4 -2 0 -9Z M78 48 q-4 7 0 9 q4 -2 0 -9Z" fill="#9FD6F5" stroke={INK} strokeWidth={1.6} />
    </motion.g>
  )},
  wow: {from: '#8CCAF0', to: '#2F82C0', glyph: (a) => (
    <g>
      <path d="M29 31 Q36.5 25 44 29.5 M56 29.5 Q63.5 25 71 31" fill="none" stroke={INK} strokeWidth={4} strokeLinecap="round" />
      <motion.g {...spin(a, {scale: [1, 1.12, 1]}, 1.3)}>
        <circle cx="38" cy="45" r="8" fill={CREAM} stroke={INK} strokeWidth={4} />
        <circle cx="62" cy="45" r="8" fill={CREAM} stroke={INK} strokeWidth={4} />
        <circle cx="38.5" cy="46" r="3.4" fill={INK} />
        <circle cx="61.5" cy="46" r="3.4" fill={INK} />
      </motion.g>
      <motion.ellipse cx="50" cy="67" rx="7" ry="9" fill={INK} {...spin(a, {scaleY: [1, 1.25, 1]}, 1.3)} />
    </g>
  )},
  gg: {from: '#6A3222', to: '#2A120C', glyph: (a) => (
    <g>
      {([[22, 26, '#5BBE6A', 20], [76, 24, '#6FB8E8', -25], [80, 74, '#A765DB', 35], [20, 72, '#F0643A', -15], [50, 16, '#F2C230', 10]] as const).map(([x, y, c, r], i) => (
        <motion.rect key={i} x={x - 3} y={y - 1.6} width={6} height={3.2} rx={1} fill={c} transform={`rotate(${r} ${x} ${y})`}
          {...(a ? {animate: {opacity: [0.35, 1, 0.35]}, transition: {duration: 1.4, delay: i * 0.25, repeat: Infinity}} : {})} />
      ))}
      <motion.text x="50" y="63" textAnchor="middle" fontFamily="'Saira Variable', Saira, sans-serif" fontWeight={850} fontSize={38}
        style={{fontVariationSettings: "'wdth' 112", paintOrder: 'stroke', transformBox: 'fill-box', transformOrigin: 'center'}}
        fill="#F2C230" stroke={INK} strokeWidth={3} strokeLinejoin="round"
        {...(a ? {animate: {scale: [1, 1.07, 1]}, transition: {duration: 1.2, repeat: Infinity, ease: 'easeInOut'}} : {})}>GG</motion.text>
    </g>
  )},
};

export function Sticker({id, size = 48, animated = false, title}: {id: StickerId; size?: number | string; animated?: boolean; title?: string}) {
  const g = useId().replace(/:/g, '');
  const look = LOOKS[id];
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label={title ?? STICKER_LABEL[id]} style={{display: 'block', overflow: 'visible'}}>
      <defs>
        <linearGradient id={`${g}d`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={look.from} />
          <stop offset="1" stopColor={look.to} />
        </linearGradient>
      </defs>
      <circle cx="50" cy="50" r="46" fill={`url(#${g}d)`} stroke="rgba(0,0,0,.28)" strokeWidth={2} />
      <ellipse cx="50" cy="26" rx="30" ry="13" fill="#fff" opacity={0.13} />
      {look.glyph(animated)}
    </svg>
  );
}
