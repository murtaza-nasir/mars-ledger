// Tile art for the board, drawn at the origin in board units (hex circumradius HEX_R).
// Each tile knows how to arrive: oceans ripple, greenery blooms, cities rise, specials stamp down.
import {motion} from 'motion/react';
import {PLAYER_HEX} from '../../ui/Icons';
import {TILE_NAME, tileKind} from '../../../shared/full';
import type {Color} from '../../../shared/full';
import {HEX_R, hexPoints} from './geometry';
import {fitText, useBoardType} from './boardType';

const R = HEX_R - 2.5;
const HEX = hexPoints(R);
const spring = {type: 'spring', stiffness: 220, damping: 18} as const;

export function Defs() {
  return (
    <defs>
      <linearGradient id="t-ocean" x1="0" y1="0" x2="0.3" y2="1">
        <stop offset="0" stopColor="#3C95D2" /><stop offset="0.55" stopColor="#1C5E92" /><stop offset="1" stopColor="#0C3558" />
      </linearGradient>
      <radialGradient id="t-ocean-glint" cx="0.35" cy="0.3" r="0.5">
        <stop offset="0" stopColor="#CFEAFF" stopOpacity="0.55" /><stop offset="1" stopColor="#CFEAFF" stopOpacity="0" />
      </radialGradient>
      <linearGradient id="t-green" x1="0" y1="0" x2="0.2" y2="1">
        <stop offset="0" stopColor="#5DAE5E" /><stop offset="1" stopColor="#23592C" />
      </linearGradient>
      <linearGradient id="t-city" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#6B7080" /><stop offset="1" stopColor="#2B2E38" />
      </linearGradient>
      <linearGradient id="t-special" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#8A5A34" /><stop offset="1" stopColor="#3E2416" />
      </linearGradient>
      <linearGradient id="s-land" x1="0" y1="0" x2="0.2" y2="1">
        <stop offset="0" stopColor="#6A3322" /><stop offset="1" stopColor="#3A1B12" />
      </linearGradient>
      <linearGradient id="s-ocean" x1="0" y1="0" x2="0.2" y2="1">
        <stop offset="0" stopColor="#23384A" /><stop offset="1" stopColor="#131E2A" />
      </linearGradient>
      <clipPath id="hex-clip"><polygon points={HEX} /></clipPath>
    </defs>
  );
}

/** Whose tile it is, readable across the room: a thick rim in the player's colour around the whole hex (over a dark
 *  under-stroke, so a green rim still reads on a greenery) and a player cube at the top. */
function Owner({color}: {color?: Color}) {
  if (!color || color === 'neutral') return null;
  const c = PLAYER_HEX[color] ?? '#999';
  return (
    <g>
      <polygon points={hexPoints(R - 3.5)} fill="none" stroke="rgba(0,0,0,.55)" strokeWidth={8} strokeLinejoin="round" />
      <polygon points={hexPoints(R - 3.5)} fill="none" stroke={c} strokeWidth={4.5} strokeLinejoin="round" />
      <g transform={`translate(0 ${-R + 18})`}>
        <rect x={-13} y={-9} width={26} height={18} rx={4} fill="rgba(0,0,0,.5)" transform="translate(1.5 2.5)" />
        <rect x={-13} y={-9} width={26} height={18} rx={4} fill={c} stroke="rgba(0,0,0,.6)" strokeWidth={1.5} />
        <rect x={-10} y={-7} width={20} height={5} rx={2.5} fill="rgba(255,255,255,.35)" />
      </g>
    </g>
  );
}

/** A space reserved without a tile (Land Claim): a tint and dashed rim in the player's colour and a planted flag,
 *  leaving the space's bonus icons readable underneath. */
export function Claim({color, flag = true}: {color: Color; flag?: boolean}) {
  const c = PLAYER_HEX[color] ?? '#999';
  return (
    <g data-claim={color}>
      <polygon points={hexPoints(R - 3.5)} fill={c} fillOpacity={0.24} stroke="rgba(0,0,0,.5)" strokeWidth={7} strokeLinejoin="round" />
      <polygon points={hexPoints(R - 3.5)} fill="none" stroke={c} strokeWidth={4} strokeDasharray="9 6" strokeLinejoin="round" />
      {/* (the 3D board plants a real flag instead: board3d/tiles3d.tsx ClaimFlag) */}
      {flag && <g transform={`translate(-9 ${-R * 0.8})`}>
        <ellipse cx={0} cy={26} rx={6.5} ry={2.4} fill="rgba(0,0,0,.45)" />
        <rect x={-1.6} y={-2} width={3.2} height={28} rx={1.4} fill="#EAF2F4" stroke="rgba(0,0,0,.5)" strokeWidth={0.8} />
        <path d="M1.6 -2 L24 5.5 L1.6 13 Z" fill={c} stroke="rgba(0,0,0,.6)" strokeWidth={1.2} strokeLinejoin="round" />
      </g>}
      <text y={R * 0.62} textAnchor="middle" fill={c} stroke="rgba(0,0,0,.7)" strokeWidth={3} paintOrder="stroke"
        style={{font: "700 12px 'Saira Variable'", fontVariationSettings: "'wdth' 80"}}>Claimed</text>
    </g>
  );
}

function Ocean({fresh}: {fresh: boolean}) {
  return (
    <g>
      <polygon points={HEX} fill="url(#t-ocean)" />
      <g clipPath="url(#hex-clip)" stroke="rgba(210,236,255,.45)" strokeWidth={1.6} fill="none" strokeLinecap="round">
        {[-14, 2, 18].map((y, i) => (
          <motion.path key={y} d={`M-40 ${y} q10 -6 20 0 t20 0 t20 0 t20 0`}
            initial={fresh ? {x: -20, opacity: 0} : false} animate={{x: [0, 10, 0], opacity: 1}}
            transition={{x: {duration: 5 + i, repeat: Infinity, ease: 'easeInOut'}, opacity: {delay: 0.4 + i * 0.1}}} />
        ))}
      </g>
      <polygon points={HEX} fill="url(#t-ocean-glint)" />
      {fresh && [0, 1, 2].map((i) => (
        <motion.circle key={i} r={10} fill="none" stroke="#BFE3FF" strokeWidth={2.5}
          initial={{scale: 0.2, opacity: 0.9}} animate={{scale: 5.5, opacity: 0}} transition={{duration: 1.6, delay: 0.15 + i * 0.35, ease: 'easeOut'}} />
      ))}
    </g>
  );
}

const CANOPY: Array<[number, number, number]> = [[-16, -6, 13], [4, -14, 14], [18, 4, 12], [-4, 10, 15], [-22, 14, 9], [16, 20, 9], [0, -30, 8]];
function Greenery({fresh}: {fresh: boolean}) {
  return (
    <g>
      <polygon points={HEX} fill="url(#t-green)" />
      <g clipPath="url(#hex-clip)">
        {CANOPY.map(([x, y, r], i) => (
          <motion.g key={i} initial={fresh ? {scale: 0} : false} animate={{scale: 1}} transition={{...spring, delay: fresh ? 0.25 + i * 0.07 : 0}}>
            <circle cx={x} cy={y} r={r} fill="#2F7A3B" />
            <circle cx={x - r * 0.25} cy={y - r * 0.3} r={r * 0.62} fill="#6CC070" opacity={0.85} />
          </motion.g>
        ))}
      </g>
    </g>
  );
}

const TOWERS: Array<[number, number, number]> = [[-26, 12, 18], [-12, 16, 34], [3, 12, 26], [16, 14, 40], [29, 10, 20]];
function City({fresh}: {fresh: boolean}) {
  return (
    <g>
      <polygon points={HEX} fill="url(#t-city)" />
      <g clipPath="url(#hex-clip)">
        <ellipse cx={0} cy={22} rx={40} ry={9} fill="rgba(0,0,0,.35)" />
        {TOWERS.map(([x, w, h], i) => (
          <motion.g key={i} initial={fresh ? {scaleY: 0} : false} animate={{scaleY: 1}}
            transition={{type: 'spring', stiffness: 160, damping: 16, delay: fresh ? 0.2 + i * 0.09 : 0}} style={{originY: 1}}>
            <rect x={x - w / 2} y={24 - h} width={w} height={h} rx={2} fill="#C9CED8" />
            <rect x={x - w / 2} y={24 - h} width={w / 2} height={h} fill="#9AA1AE" />
            {Array.from({length: Math.floor(h / 9)}, (_, k) => (
              <motion.rect key={k} x={x - w / 2 + 3} y={24 - h + 4 + k * 9} width={w - 6} height={2.6} rx={1} fill="#F2C230"
                initial={fresh ? {opacity: 0} : false} animate={{opacity: 0.9}} transition={{delay: fresh ? 0.9 + k * 0.05 + i * 0.05 : 0}} />
            ))}
          </motion.g>
        ))}
        <path d="M-44 24 H44" stroke="rgba(255,255,255,.25)" strokeWidth={1.2} />
      </g>
    </g>
  );
}

/** Short labels for special tiles: one word that stays legible across the room (the full name is in TILE_NAME). */
export const SPECIAL_SHORT: Record<number, string> = {
  3: 'Capital', 4: 'Commerce', 5: 'Eco zone', 6: 'Industry', 7: 'Lava', 8: 'Mine', 9: 'Mine', 10: 'Mohole', 11: 'Preserve',
  12: 'Nuclear', 13: 'Restricted', 27: 'Mine', 28: 'Mine',
};

/** A small glyph per special tile, drawn about 24 units across. */
function SpecialGlyph({tileType}: {tileType: number}) {
  const c = '#F5E6CF';
  switch (tileType) {
  case 8: case 9: case 27: case 28: // a pick over a rock
    return <g fill="none" stroke={c} strokeWidth={2.4} strokeLinecap="round"><path d="M-10 6 L9 -9" /><path d="M2 -12 C8 -10 12 -6 13 0" /><path d="M-12 10 h12" opacity=".6" /></g>;
  case 12: // a trefoil
    return <g fill={c}><circle r={3} /><path d="M0 -4 L-6 -12 A12 12 0 0 1 6 -12z" /><path d="M3.5 2 L12 4 A12 12 0 0 1 6 12z" /><path d="M-3.5 2 L-6 12 A12 12 0 0 1 -12 4z" /></g>;
  case 10: // a shaft going down
    return <g fill="none" stroke={c} strokeWidth={2.4} strokeLinecap="round"><ellipse rx={11} ry={4} cy={-7} /><path d="M-6 -3 L-3 9 M6 -3 L3 9" /><path d="M0 -2 v9 m-3 -3 l3 3 3-3" /></g>;
  case 11: // a leaf
    return <path d="M-10 9 C-10 -6 0 -12 11 -11 C11 0 4 10 -10 9z M-10 9 L4 -4" fill="none" stroke={c} strokeWidth={2.4} strokeLinejoin="round" />;
  case 4: // a coin
    return <g><circle r={11} fill="none" stroke={c} strokeWidth={2.4} /><path d="M-5 5 V-4 l5 5 5-5 v9" fill="none" stroke={c} strokeWidth={2.2} /></g>;
  case 6: // a factory
    return <path d="M-12 10 V-2 l7 -5 v5 l7 -5 v5 l7 -5 V10z M8 -2 V-12 h4 V10" fill="none" stroke={c} strokeWidth={2.2} strokeLinejoin="round" />;
  case 5: // a paw
    return <g fill={c}><ellipse cy={4} rx={6} ry={5} /><circle cx={-7} cy={-4} r={2.6} /><circle cx={-2.5} cy={-9} r={2.6} /><circle cx={2.5} cy={-9} r={2.6} /><circle cx={7} cy={-4} r={2.6} /></g>;
  case 7: // a flame
    return <path d="M0 -12 c2 5 8 7 8 13 a8 8 0 0 1 -16 0 c0 -4 3 -6 4 -8 0 3 2 5 3 5 0 -4 0 -6 1 -10z" fill={c} />;
  case 13: // a barrier
    return <g fill="none" stroke={c} strokeWidth={2.4}><rect x={-12} y={-6} width={24} height={8} rx={1.5} /><path d="M-6 -6 l-4 8 M2 -6 l-4 8 M10 -6 l-4 8" /><path d="M-9 2 v8 M9 2 v8" strokeLinecap="round" /></g>;
  default:
    return <path d="M0 -11 l3 7 7 1 -5 5 1.5 7 -6.5 -3.5 -6.5 3.5 1.5 -7 -5 -5 7 -1z" fill={c} />;
  }
}

function Special({tileType}: {tileType: number}) {
  const t = useBoardType();
  const label = SPECIAL_SHORT[tileType] ?? (TILE_NAME[tileType] ?? 'Special').split(' ')[0];
  // the label sits in the hex's full-width band (sides run from y -25 to 25), the glyph above it; 62 units
  // leaves it clear of the owner's rim, which runs inside the hex edge
  const size = fitText(t, label.length, 62, 0.37);
  return (
    <g>
      <polygon points={HEX} fill="url(#t-special)" />
      <polygon points={hexPoints(R - 7)} fill="none" stroke="rgba(242,194,48,.55)" strokeWidth={1.4} strokeDasharray="3 3" />
      <g transform={`translate(0 ${-6 - size * 0.25}) scale(${Math.min(0.9, Math.max(0.75, t.icon * 0.75))})`} opacity={0.9}><SpecialGlyph tileType={tileType} /></g>
      <text textAnchor="middle" y={8 + size * 0.55} fill="#F5E6CF" textLength={label.length * size * 0.37 > 56 ? 62 : undefined} lengthAdjust="spacingAndGlyphs"
        style={{font: `700 ${size.toFixed(1)}px 'Saira Variable'`, fontVariationSettings: "'wdth' 64"}}>
        {label}
      </text>
    </g>
  );
}

/** A placed tile. `fresh` plays its arrival. */
export function Tile({tileType, color, fresh}: {tileType: number; color?: Color; fresh: boolean}) {
  const kind = tileKind(tileType);
  return (
    <motion.g
      initial={fresh ? {scale: 1.9, opacity: 0, y: -60} : false}
      animate={{scale: 1, opacity: 1, y: 0}}
      transition={{type: 'spring', stiffness: 260, damping: 20}}
    >
      {fresh && (
        <motion.polygon points={HEX} fill="none" stroke={color ? PLAYER_HEX[color] : '#fff'} strokeWidth={4}
          initial={{scale: 1, opacity: 0.9}} animate={{scale: 2.6, opacity: 0}} transition={{duration: 1.1, delay: 0.22, ease: 'easeOut'}} />
      )}
      {kind === 'ocean' && <Ocean fresh={fresh} />}
      {kind === 'greenery' && <Greenery fresh={fresh} />}
      {kind === 'city' && <City fresh={fresh} />}
      {kind === 'special' && <Special tileType={tileType} />}
      <polygon points={HEX} fill="none" stroke="rgba(255,255,255,.18)" strokeWidth={1.2} />
      <Owner color={color} />
    </motion.g>
  );
}

/** The ground under a 3D tile model (board3d/tiles3d.tsx): the tile's colour and a street grid under a city. A
 *  special tile's name is an HTML label over its model (Board3D), so the model never hides it. */
export function GroundTop3D({tileType}: {tileType: number}) {
  const kind = tileKind(tileType);
  if (kind === 'ocean') return <polygon points={HEX} fill="url(#t-ocean)" />;
  if (kind === 'greenery') return <polygon points={HEX} fill="url(#t-green)" />;
  if (kind === 'city') {
    return (
      <g>
        <polygon points={HEX} fill="url(#t-city)" />
        <g clipPath="url(#hex-clip)" stroke="rgba(255,226,180,.28)" strokeWidth={1.1}>
          {[-30, -15, 0, 15, 30].map((v) => <path key={`h${v}`} d={`M-50 ${v} H50`} />)}
          {[-30, -15, 0, 15, 30].map((v) => <path key={`v${v}`} d={`M${v} -50 V50`} />)}
        </g>
      </g>
    );
  }
  return (
    <g>
      <polygon points={HEX} fill="url(#t-special)" />
      <polygon points={hexPoints(R - 7)} fill="none" stroke="rgba(242,194,48,.55)" strokeWidth={1.4} strokeDasharray="3 3" />
    </g>
  );
}

/** A player's finger on their phone: a breathing outline of the tile they are about to place. */
export function Ghost({color, tile, name}: {color: Color; tile: string | null; name: string}) {
  const t = useBoardType();
  const c = PLAYER_HEX[color] ?? '#fff';
  const text = `${name}${tile ? ` · ${tile}` : ''}`;
  // the pill grows with its text; the label is never smaller than the board's text floor
  const size = t.text;
  const w = Math.max(108, text.length * size * 0.5 + size * 1.6);
  const h = size * 1.7;
  return (
    <motion.g initial={{opacity: 0, scale: 0.8}} animate={{opacity: 1, scale: 1}} exit={{opacity: 0, scale: 0.8}} transition={{duration: 0.25}}>
      <motion.polygon points={HEX} fill={c} animate={{opacity: [0.18, 0.42, 0.18]}} transition={{duration: 1.4, repeat: Infinity}} />
      <polygon points={HEX} fill="none" stroke={c} strokeWidth={4} strokeDasharray="10 6" />
      <g transform={`translate(0 ${R + h * 0.5 + 4})`}>
        <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={h / 2} fill="rgba(12,5,3,.88)" stroke={c} strokeWidth={1.5} />
        <text textAnchor="middle" y={size * 0.35} fill="#EAF2F4" style={{font: `650 ${size.toFixed(1)}px 'Saira Variable'`}}>{text}</text>
      </g>
    </motion.g>
  );
}
