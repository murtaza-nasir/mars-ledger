// A person's face at the table: a corporation portrait they chose, or a monogram in their colour.
import {PLAYER_HEX} from './Icons';

export const PORTRAITS = ['R00', 'R03', 'R08', 'R09', 'R13', 'R17', 'R18', 'R19', 'R24', 'R30', 'R31', 'R32', 'R43'];

export function Avatar({name, color, avatar, size = 40, ring = true}: {name: string; color: string; avatar: string | null; size?: number; ring?: boolean}) {
  const hex = PLAYER_HEX[color] ?? 'var(--ice-dim)';
  const initials = name.trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?';
  return (
    <span aria-hidden="true" style={{position: 'relative', flex: 'none', width: size, height: size, borderRadius: '50%', overflow: 'hidden', display: 'grid', placeItems: 'center',
      background: avatar ? '#1A0D0A' : `radial-gradient(circle at 35% 30%, color-mix(in oklab, ${hex} 70%, white), ${hex} 55%, color-mix(in oklab, ${hex} 55%, black))`,
      boxShadow: ring ? `0 0 0 ${Math.max(1.5, size / 22)}px ${hex}` : 'none'}}>
      {avatar
        ? <img src={`/portraits/${avatar}.webp`} alt="" loading="lazy" decoding="async" style={{width: '100%', height: '100%', objectFit: 'cover'}} />
        : <span className="num" style={{fontSize: size * 0.4, color: 'rgba(20,8,4,.82)', letterSpacing: '-0.04em'}}>{initials}</span>}
    </span>
  );
}
