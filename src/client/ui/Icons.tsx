// Resource and tag glyphs. Drawn for this app; colours follow the physical player board.
import type {Resource} from '../../shared/types';

export const RES_COLOR: Record<Resource | 'tr', string> = {
  megacredits: 'var(--mc)', steel: 'var(--steel)', titanium: 'var(--titanium)', plants: 'var(--plants)',
  energy: 'var(--energy)', heat: 'var(--heat)', tr: 'var(--tr)',
};
export const RES_LABEL: Record<Resource, string> = {
  megacredits: 'M€', steel: 'Steel', titanium: 'Titanium', plants: 'Plants', energy: 'Energy', heat: 'Heat',
};

export function ResIcon({r, size = 22}: {r: Resource | 'tr'; size?: number}) {
  const c = RES_COLOR[r];
  const common = {width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': true} as const;
  switch (r) {
  case 'megacredits':
    return <svg {...common}><rect x="2.5" y="2.5" width="19" height="19" rx="4" fill={c} /><path d="M7 16.5V8l5 5 5-5v8.5" stroke="#3A2503" strokeWidth="2.2" fill="none" strokeLinejoin="round" strokeLinecap="round" /></svg>;
  case 'steel':
    return <svg {...common}><path d="M4 8.5 12 4l8 4.5v7L12 20l-8-4.5z" fill={c} /><path d="M4 8.5 12 13l8-4.5M12 13v7" stroke="#3B2410" strokeWidth="1.4" fill="none" opacity=".55" /></svg>;
  case 'titanium':
    return <svg {...common}><path d="M4 8.5 12 4l8 4.5v7L12 20l-8-4.5z" fill="#2E313B" stroke={c} strokeWidth="1.2" /><path d="m12 7.2 1.4 2.9 3.2.4-2.3 2.2.6 3.1L12 14.3l-2.9 1.5.6-3.1-2.3-2.2 3.2-.4z" fill="var(--mc)" /></svg>;
  case 'plants':
    return <svg {...common}><path d="M12 21c-5-3-7-7-6-13 5 0 9 3 9 8M12 21c4-2 6-6 6-11-3 0-6 2-6 5" fill={c} /><path d="M12 21V11" stroke="#173A1E" strokeWidth="1.3" /></svg>;
  case 'energy':
    return <svg {...common}><circle cx="12" cy="12" r="9.5" fill={c} /><path d="M13.2 4.8 8 13h3.6l-1.1 6.2L16 11h-3.7z" fill="#F3E6FF" /></svg>;
  case 'heat':
    return <svg {...common}><path d="M12 2.5c1 3.5 5.5 5.5 5.5 10.5a5.5 5.5 0 0 1-11 0c0-2.5 1.3-4 2.3-5 .2 1.8.9 2.8 2 3.3C10.4 8.5 11 5.5 12 2.5z" fill={c} /><path d="M12 12.5c.6 1.5 2.3 2.3 2.3 4a2.3 2.3 0 0 1-4.6 0c0-1.2.9-2 2.3-4z" fill="#FFD9A0" /></svg>;
  case 'tr':
    return <svg {...common}><path d="M12 2.8 20 7.4v9.2L12 21.2 4 16.6V7.4z" fill={c} /><path d="M8 14.5c2-1.2 3.5.8 8-.8" stroke="#0E2E47" strokeWidth="1.6" fill="none" strokeLinecap="round" /><circle cx="12" cy="9.5" r="2" fill="#0E2E47" /></svg>;
  }
}

export const TAG_COLOR: Record<string, string> = {
  building: '#9A6433', space: '#2B2D38', science: '#EDEDED', power: '#8E3FBF', earth: '#2F6FB8', jovian: '#D9894A',
  plant: '#3E9A4C', microbe: '#7BB86F', animal: '#2F7A3B', city: '#7B7F8A', event: '#1B1B22', venus: '#C9A36B', wild: '#999',
};

const TAG_GLYPH: Record<string, string> = {
  building: 'M6 18V9l6-4 6 4v9M9.5 18v-5h5v5',
  space: 'm12 5 1.6 4.1 4.4.3-3.4 2.8 1.1 4.3L12 14.2l-3.7 2.3 1.1-4.3L6 9.4l4.4-.3z',
  science: 'M12 12m-1.6 0a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0-3.2 0M5 12c0-2 3.1-3.6 7-3.6s7 1.6 7 3.6-3.1 3.6-7 3.6S5 14 5 12M8.5 6c1.7-1 4.6 1 6.6 4.5s2.1 7 .4 8M15.5 6c-1.7-1-4.6 1-6.6 4.5s-2.1 7-.4 8',
  power: 'M13 4 7.5 13h4l-1 7L16.5 11h-4z',
  earth: 'M12 12m-6.5 0a6.5 6.5 0 1 0 13 0a6.5 6.5 0 1 0-13 0M7 9.5c2 .5 3 2 2.5 3.5s1 2.5 2.5 2M13.5 6c-.5 1.5.5 2.5 2 2.5s2 1.5 1.5 3',
  jovian: 'M12 12m-5 0a5 5 0 1 0 10 0a5 5 0 1 0-10 0M4 14c3-1 13-5 16-4',
  plant: 'M12 19c-4-2.5-5.5-6-4.8-11 4 0 7 2.5 7 6.5M12 19c3-1.7 4.5-4.7 4.5-8.5-2.3 0-4.5 1.7-4.5 4',
  microbe: 'M9 9m-2.6 0a2.6 2.6 0 1 0 5.2 0a2.6 2.6 0 1 0-5.2 0M15 14.5m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0M8.5 16.5m-1.5 0a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0',
  animal: 'M8 9.5m-1.5 0a1.5 1.8 0 1 0 3 0a1.5 1.8 0 1 0-3 0M16 9.5m-1.5 0a1.5 1.8 0 1 0 3 0a1.5 1.8 0 1 0-3 0M11 6.8m-1.3 0a1.3 1.6 0 1 0 2.6 0a1.3 1.6 0 1 0-2.6 0M13 6.8m-1.3 0a1.3 1.6 0 1 0 2.6 0a1.3 1.6 0 1 0-2.6 0M12 12c-3 0-4.5 3.5-3.5 5s2.5.5 3.5.5 2.5 1 3.5-.5-.5-5-3.5-5',
  city: 'M5 19V11l3-2v10M8 19V7l4-2v14M12 19V9h4v10M16 19v-6h3v6',
  event: 'M6 12h9M11.5 7.5 16 12l-4.5 4.5',
  venus: 'M12 10m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0M12 14v6M9.5 17.5h5',
  wild: 'M12 6v12M6 12h12',
};

export function TagIcon({tag, size = 24}: {tag: string; size?: number}) {
  const bg = TAG_COLOR[tag] ?? '#555';
  const fg = tag === 'science' ? '#1B1B22' : '#F5F1EA';
  const filled = ['space', 'power'].includes(tag);
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" role="img" aria-label={`${tag} tag`}>
      <circle cx="12" cy="12" r="11" fill={bg} stroke="rgba(255,255,255,.28)" strokeWidth=".8" />
      <path d={TAG_GLYPH[tag] ?? ''} fill={filled ? fg : 'none'} stroke={filled ? 'none' : fg} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export {PLAYER_HEX} from '../../shared/game';
