// Mars as a hex map: the Mars tab (read-only) and the space picker (valid spaces pulse, tap to preview).
import {AnimatePresence, motion} from 'motion/react';
import {useMemo, useRef, useState} from 'react';
import {BONUS_NAME, TILE_NAME, tileKind} from '../../../shared/full';
import {HELLAS_BONUS_OCEAN_COST} from '../../../shared/board';
import type {Color, SpaceModel} from '../../../shared/full';
import {PLAYER_HEX, ResIcon} from '../../ui/Icons';

const R = 22;
const W = Math.sqrt(3) * R;

export function hexCenter(s: SpaceModel): {x: number; y: number} {
  const col = s.x - Math.abs(4 - s.y) / 2;
  return {x: col * W + W / 2 + 4, y: s.y * 1.5 * R + R + 4};
}
const BOARD_W = 9 * W + 8;
const BOARD_H = 8 * 1.5 * R + 2 * R + 8;

function hexPath(cx: number, cy: number, r: number) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 90);
    pts.push(`${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`);
  }
  return `M${pts.join('L')}Z`;
}

const TILE_FILL = {
  greenery: 'url(#g-greenery)', ocean: 'url(#g-ocean)', city: 'url(#g-city)', special: 'url(#g-special)',
} as const;

function TileGlyph({kind, cx, cy}: {kind: 'greenery' | 'ocean' | 'city' | 'special'; cx: number; cy: number}) {
  const s = 0.62;
  const t = `translate(${cx - 12 * s},${cy - 12 * s}) scale(${s})`;
  if (kind === 'greenery') return <path transform={t} d="M12 21c-5-3-7-7-6-13 5 0 9 3 9 8M12 21c4-2 6-6 6-11-3 0-6 2-6 5" fill="rgba(230,255,220,.85)" />;
  if (kind === 'ocean') return <path transform={t} d="M3 10c3-2 6 2 9 0s6 2 9 0M3 15c3-2 6 2 9 0s6 2 9 0" stroke="rgba(220,240,255,.9)" strokeWidth="2" fill="none" strokeLinecap="round" />;
  if (kind === 'city') return <path transform={t} d="M4 20V11l4-3v12M8 20V6l5-2v16M13 20V9h5v11M18 20v-6h3v6" stroke="rgba(245,245,250,.95)" strokeWidth="1.8" fill="none" strokeLinejoin="round" />;
  return <path transform={t} d="M12 4l7 4v8l-7 4-7-4V8z" stroke="rgba(255,230,190,.95)" strokeWidth="1.8" fill="none" />;
}

function BonusGlyphs({bonus, cx, cy}: {bonus: number[]; cx: number; cy: number}) {
  const shown = bonus.filter((b) => BONUS_NAME[b]).slice(0, 3);
  if (!shown.length) return null;
  const size = shown.length > 2 ? 11 : 13;
  const gap = size + 1;
  return (
    <g>
      {shown.map((b, i) => {
        const name = BONUS_NAME[b];
        const x = cx - (shown.length * gap) / 2 + i * gap + 0.5;
        const y = cy - size / 2;
        if (name === 'ocean') {
          // Hellas south pole: a tile here lets its owner buy an extra ocean
          return <path key={i} transform={`translate(${x + size / 2},${y + size / 2}) scale(${size / 20})`}
            d="M0 -9C3 -4 6 0 6 3.5a6 6 0 0 1-12 0C-6 0-3-4 0-9z" fill="#5AA9DE" stroke="rgba(0,0,0,.35)" strokeWidth={1} />;
        }
        if (name === 'card') {
          return <rect key={i} x={x + size * 0.18} y={y} width={size * 0.64} height={size} rx={1.6} fill="#EADBB8" stroke="#6b4b2a" strokeWidth=".9" />;
        }
        return <g key={i} transform={`translate(${x},${y})`}><ResIcon r={name as 'steel'} size={size} /></g>;
      })}
    </g>
  );
}

export type HexBoardProps = {
  spaces: SpaceModel[];
  selectable?: string[];
  selected?: string | null;
  ghost?: {kind: 'greenery' | 'ocean' | 'city' | 'special'; color: Color} | null;
  onPick?: (id: string) => void;
  /** other players' hovers to show as faint ghosts */
  hovers?: Array<{spaceId: string | null; color: Color}>;
  compact?: boolean;
};

export function HexBoard({spaces, selectable, selected, ghost, onPick, hovers, compact}: HexBoardProps) {
  const onMap = useMemo(() => spaces.filter((s) => s.x >= 0 && s.y >= 0), [spaces]);
  const offMap = useMemo(() => spaces.filter((s) => (s.x < 0 || s.y < 0) && (s.tileType !== undefined || selectable?.includes(s.id))), [spaces, selectable]);
  const sel = new Set(selectable ?? []);
  return (
    <svg viewBox={`0 0 ${BOARD_W} ${BOARD_H + (offMap.length ? 34 : 0)}`} width="100%" style={{display: 'block', touchAction: 'manipulation'}}
      role="img" aria-label="Mars map">
      <defs>
        <radialGradient id="g-land" cx="50%" cy="35%" r="70%"><stop offset="0" stopColor="#8A3E22" /><stop offset="1" stopColor="#5A2414" /></radialGradient>
        <radialGradient id="g-oceanspace" cx="50%" cy="35%" r="70%"><stop offset="0" stopColor="#2A3F5C" /><stop offset="1" stopColor="#18233A" /></radialGradient>
        <radialGradient id="g-greenery" cx="45%" cy="35%" r="75%"><stop offset="0" stopColor="#6CCB6F" /><stop offset="1" stopColor="#2C7A3A" /></radialGradient>
        <radialGradient id="g-ocean" cx="45%" cy="35%" r="75%"><stop offset="0" stopColor="#5AA9DE" /><stop offset="1" stopColor="#1B4F86" /></radialGradient>
        <radialGradient id="g-city" cx="45%" cy="35%" r="75%"><stop offset="0" stopColor="#A9ADB8" /><stop offset="1" stopColor="#4D515C" /></radialGradient>
        <radialGradient id="g-special" cx="45%" cy="35%" r="75%"><stop offset="0" stopColor="#D69A52" /><stop offset="1" stopColor="#7A4A1E" /></radialGradient>
      </defs>
      <g transform={offMap.length ? 'translate(0,34)' : undefined}>
        {onMap.map((s) => {
          const {x: cx, y: cy} = hexCenter(s);
          const kind = tileKind(s.tileType);
          const isSel = sel.has(s.id);
          const isChosen = selected === s.id;
          const oceanSpace = s.spaceType === 'ocean';
          const hover = hovers?.find((h) => h.spaceId === s.id);
          return (
            <g key={s.id} data-space={s.id} onClick={isSel && onPick ? () => onPick(s.id) : undefined} style={{cursor: isSel ? 'pointer' : 'default'}}>
              <title>{kind ? TILE_NAME[s.tileType!] ?? kind : oceanSpace ? 'Ocean space' : 'Land'}{s.color ? ` · ${s.color}` : ''}</title>
              <path d={hexPath(cx, cy, R - 1.2)} fill={oceanSpace ? 'url(#g-oceanspace)' : 'url(#g-land)'}
                stroke={oceanSpace ? 'rgba(90,169,222,.45)' : 'rgba(255,190,150,.16)'} strokeWidth={1} opacity={selectable && !isSel && !kind ? 0.45 : 1} />
              {!kind && !compact && <BonusGlyphs bonus={s.bonus} cx={cx} cy={cy} />}
              <AnimatePresence>
                {kind && (
                  <motion.g key={`t${s.tileType}`} initial={{scale: 0.2, opacity: 0}} animate={{scale: 1, opacity: 1}} exit={{opacity: 0}}
                    transition={{type: 'spring', stiffness: 260, damping: 16}} style={{transformOrigin: `${cx}px ${cy}px`}}>
                    <path d={hexPath(cx, cy, R - 2)} fill={TILE_FILL[kind]} stroke="rgba(0,0,0,.35)" strokeWidth={1} />
                    <TileGlyph kind={kind} cx={cx} cy={cy - (s.color ? 3 : 0)} />
                    {s.color && <rect x={cx - 4.5} y={cy + 7} width={9} height={9} rx={2} fill={PLAYER_HEX[s.color] ?? '#999'} stroke="rgba(0,0,0,.5)" strokeWidth={1} />}
                  </motion.g>
                )}
              </AnimatePresence>
              {hover && !isChosen && (
                <path d={hexPath(cx, cy, R - 3)} fill="none" stroke={PLAYER_HEX[hover.color] ?? '#fff'} strokeWidth={2.5} strokeDasharray="4 3" opacity={0.8} />
              )}
              {isSel && !isChosen && (
                <motion.path d={hexPath(cx, cy, R - 2.5)} fill="rgba(234,242,244,.16)" stroke="var(--ice)" strokeWidth={2.4}
                  animate={{opacity: [0.45, 1, 0.45]}} transition={{duration: 1.6, repeat: Infinity, ease: 'easeInOut'}} />
              )}
              {isChosen && ghost && (
                <motion.g initial={{scale: 1.6, opacity: 0}} animate={{scale: 1, opacity: 1}} transition={{type: 'spring', stiffness: 300, damping: 18}}
                  style={{transformOrigin: `${cx}px ${cy}px`}}>
                  <path d={hexPath(cx, cy, R - 2)} fill={TILE_FILL[ghost.kind]} opacity={0.85} stroke={PLAYER_HEX[ghost.color]} strokeWidth={3} />
                  <TileGlyph kind={ghost.kind} cx={cx} cy={cy} />
                </motion.g>
              )}
            </g>
          );
        })}
      </g>
      {offMap.map((s, i) => {
        const cx = 18 + i * 44;
        const cy = 17;
        const kind = tileKind(s.tileType);
        const isSel = sel.has(s.id);
        return (
          <g key={s.id} data-space={s.id} onClick={isSel && onPick ? () => onPick(s.id) : undefined}>
            <circle cx={cx} cy={cy} r={14} fill={kind ? TILE_FILL[kind] : '#2A1A2A'} stroke={isSel ? 'var(--ice)' : 'rgba(255,255,255,.2)'} strokeWidth={isSel ? 2 : 1} />
            {s.color && <rect x={cx - 4} y={cy - 4} width={8} height={8} rx={2} fill={PLAYER_HEX[s.color]} />}
          </g>
        );
      })}
    </svg>
  );
}

/** The space picker: board you can zoom and pan, with a confirm bar. */
export function SpacePicker({spaces, valid, color, kind, title, onHover, onConfirm, busy}: {
  spaces: SpaceModel[]; valid: string[]; color: Color; kind: 'greenery' | 'ocean' | 'city' | 'special'; title: string;
  onHover: (id: string | null) => void; onConfirm: (id: string) => void; busy?: boolean;
}) {
  const [chosen, setChosen] = useState<string | null>(null);
  const [zoom, setZoom] = useState(false);
  const frame = useRef<HTMLDivElement>(null);
  const pick = (id: string) => { setChosen(id); onHover(id); navigator.vibrate?.(12); };
  const space = spaces.find((s) => s.id === chosen);
  const bonus = space?.bonus.map((b) => BONUS_NAME[b]).filter(Boolean) ?? [];
  // centre the zoomed view on the chosen space
  const c = space ? hexCenter(space) : {x: BOARD_W / 2, y: BOARD_H / 2};
  const origin = `${(c.x / BOARD_W) * 100}% ${(c.y / BOARD_H) * 100}%`;
  return (
    <div>
      <div ref={frame} style={{position: 'relative', overflow: 'hidden', borderRadius: 18, background: 'radial-gradient(90% 80% at 50% 40%, #3A1B12, #1A0D0A)',
        boxShadow: 'inset 0 0 0 1px var(--rim)', padding: 6}}>
        <motion.div animate={{scale: zoom ? 1.9 : 1}} transition={{type: 'spring', stiffness: 200, damping: 26}} style={{transformOrigin: origin}}
          drag={zoom} dragConstraints={frame} dragElastic={0.15}>
          <HexBoard spaces={spaces} selectable={valid} selected={chosen} ghost={{kind, color}} onPick={pick} />
        </motion.div>
        <button onClick={() => setZoom((z) => !z)} aria-label={zoom ? 'Zoom out' : 'Zoom in'}
          style={{position: 'absolute', right: 10, bottom: 10, width: 40, height: 40, borderRadius: 12, background: 'rgba(0,0,0,.5)', backdropFilter: 'blur(6px)', fontSize: 20}}>
          {zoom ? '−' : '+'}
        </button>
      </div>
      <div style={{display: 'flex', alignItems: 'center', gap: 12, marginTop: 14, minHeight: 52}}>
        <div style={{flex: 1, fontSize: 15}}>
          {chosen ? (
            <>
              <div style={{fontWeight: 650}}>Space {chosen}</div>
              <div className="muted" style={{fontSize: 13.5}}>{bonus.length ? `Gives ${bonus.map((b) => (b === 'card' ? 'a card' : b === 'ocean' ? `the right to buy an extra ocean for ${HELLAS_BONUS_OCEAN_COST} M€` : b)).join(', ')}` : 'No placement bonus'}</div>
            </>
          ) : <span className="muted">{valid.length} legal spaces glow. Tap one to preview it on the TV.</span>}
        </div>
        <button className="btn warm" disabled={!chosen || busy} onClick={() => chosen && onConfirm(chosen)}>
          {busy ? 'Placing…' : title}
        </button>
      </div>
    </div>
  );
}
