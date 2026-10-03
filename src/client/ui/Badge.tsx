// Achievement badges: one family. A hex medallion (the shape of a Mars tile) with a tier ring —
// bronze, silver or gold — around a dark oxide face and a line glyph. Locked badges are drawn in
// ash with the glyph faint, so the collection reads at a glance.
import {useId} from 'react';
import {ACHIEVEMENT_BY_ID} from '../../shared/achievements';
import type {Tier} from '../../shared/achievements';

const TIER: Record<Tier, [string, string, string]> = {
  bronze: ['#7A4A24', '#D08A52', '#F3C08E'],
  silver: ['#5E6574', '#B9C1D0', '#F2F6FA'],
  gold: ['#8A6410', '#F2C230', '#FFF0A8'],
};
const ASH: [string, string, string] = ['#3A2A26', '#5A4A45', '#7A6A64'];

// 24x24 line glyphs, drawn for these badges (stroke, round caps).
export const GLYPHS: Record<string, string> = {
  lander: 'M12 4v3M8 11a4 4 0 0 1 8 0v2H8zM9 13l-3 6M15 13l3 6M5 19h4M15 19h4',
  trophy: 'M8 4h8v5a4 4 0 0 1-8 0zM8 6H5.5a2.5 2.5 0 0 0 3 4M16 6h2.5a2.5 2.5 0 0 1-3 4M12 13v3M9 20h6M10 16h4l.5 4h-5z',
  three: 'M8 6h7l-4 5a4 4 0 1 1-3 6',
  chevrons: 'M6 7l6 4 6-4M6 12l6 4 6-4M6 17l6 4 6-4',
  clover: 'M12 12a3.2 3.2 0 1 1 0-5 3.2 3.2 0 1 1 5 5 3.2 3.2 0 1 1-5 5 3.2 3.2 0 1 1-5-5 3.2 3.2 0 1 1 5 0zM12 12l3 8',
  twin: 'M8 5v14M16 5v14M5 9h6M13 9h6M8 5l-2 3M16 5l2 3',
  flag: 'M6 21V4M6 4h10l-2 3 2 3H6M11 4v6',
  mountain: 'M3 19l6-9 3 4 3-6 6 11zM9 10l2 3',
  drop: 'M12 3c3 4 6 7 6 11a6 6 0 0 1-12 0c0-4 3-7 6-11zM9 15a3 3 0 0 0 3 3',
  thermo: 'M12 4a2 2 0 0 1 2 2v8a4 4 0 1 1-4 0V6a2 2 0 0 1 2-2zM12 10v7M16 7h3M16 10h2',
  o2: 'M9 9a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zM15 15h4l-4 4h4M17 5a2 2 0 1 1 0 .01',
  globe: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
  city: 'M4 20V11l4-2v11M8 20V6l5-2v16M13 20V9h5v11M3 20h18',
  skyline: 'M3 20V13h3V9h3v11M9 20V5h4v15M13 20V11h3V8h3v12M2 20h20',
  leaf: 'M5 19C5 10 11 5 19 5c0 8-5 14-14 14zM5 19l8-8',
  waves: 'M3 9c3-2 6 2 9 0s6-2 9 0M3 14c3-2 6 2 9 0s6-2 9 0M3 19c3-2 6 2 9 0s6-2 9 0',
  cards: 'M7 5h9a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM9 3h9a1 1 0 0 1 1 1v12',
  coin: 'M12 4a8 8 0 1 1 0 16 8 8 0 0 1 0-16zM9 15V9l3 3 3-3v6',
  pennant: 'M6 21V3M6 4l12 4-12 4M10 16h8M10 19h6',
  meteor: 'M15 9a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zM3 3l9 7M6 3l7 5M3 6l7 6',
  dove: 'M4 13c4 0 7-3 8-7 1 3 3 5 7 5-1 4-4 7-9 7l-3 3v-4c-2-1-3-2-3-4zM16 9h.01',
  bolt: 'M13 3L6 13h5l-1 8 7-10h-5z',
  hourglass: 'M7 3h10M7 21h10M8 3c0 5 8 5 8 9s-8 4-8 9M16 3c0 5-8 5-8 9s8 4 8 9',
  compass: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM15.5 8.5l-2 5-5 2 2-5z',
  map: 'M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14',
  stack: 'M12 3l9 5-9 5-9-5zM3 12l9 5 9-5M3 16l9 5 9-5',
};

export function Badge({id, size = 72, locked = false}: {id: string; size?: number; locked?: boolean}) {
  const def = ACHIEVEMENT_BY_ID.get(id);
  const uid = useId().replace(/:/g, '');
  const [dark, mid, light] = locked || !def ? ASH : TIER[def.tier];
  const hex = 'M50 3 91 26.5v47L50 97 9 73.5v-47z';
  const inner = 'M50 13 82 31.5v37L50 87 18 68.5v-37z';
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label={def ? `${def.name}${locked ? ' (locked)' : ''}` : id}
      style={{flex: 'none', filter: locked ? 'none' : `drop-shadow(0 ${size / 18}px ${size / 10}px rgba(0,0,0,.45))`}}>
      <defs>
        <linearGradient id={`r${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={light} /><stop offset=".45" stopColor={mid} /><stop offset="1" stopColor={dark} />
        </linearGradient>
        <radialGradient id={`f${uid}`} cx=".4" cy=".3" r=".9">
          <stop offset="0" stopColor={locked ? '#2A201D' : '#4A2218'} /><stop offset="1" stopColor={locked ? '#171210' : '#1A0D0A'} />
        </radialGradient>
      </defs>
      <path d={hex} fill={`url(#r${uid})`} />
      <path d={inner} fill={`url(#f${uid})`} stroke={dark} strokeWidth="1.2" />
      <path d={inner} fill="none" stroke="rgba(255,255,255,.12)" strokeWidth="1" transform="translate(0 -1)" />
      <g transform="translate(26 26) scale(2)" fill="none" stroke={locked ? '#6A5A55' : light} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" opacity={locked ? 0.7 : 1}>
        <path d={GLYPHS[def?.glyph ?? ''] ?? GLYPHS.lander} />
      </g>
      {!locked && <path d="M50 3 91 26.5 50 50z" fill="rgba(255,255,255,.10)" />}
    </svg>
  );
}
