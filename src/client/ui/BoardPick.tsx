// The table's map choice in the lobby: a mini map of each board drawn from the engine's own board data,
// with the chosen board's milestones and awards. Table-wide: any player can change it before the start.
import {AnimatePresence, motion} from 'motion/react';
import {BOARDS, BOARD_NAMES} from '../../shared/board';
import type {BoardChoice, BoardName} from '../../shared/board';
import boards from '../../shared/data/boards.json';

type BoardSpace = {id: string; x: number; y: number; spaceType: string; bonus: number[]; volcanic?: boolean};
const DATA = boards as Record<BoardName, BoardSpace[]>;

const R = 5.2;
const W = Math.sqrt(3) * R;
function hex(cx: number, cy: number, r: number) {
  let d = '';
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 90);
    d += `${i ? 'L' : 'M'}${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`;
  }
  return d + 'Z';
}

/** Same layout rule as the TV and phone boards: row y, column x in a 9-wide grid indented by |4 − y|. */
export function MiniMap({board, size = 88}: {board: BoardName; size?: number}) {
  const spaces = DATA[board].filter((s) => s.x >= 0);
  const w = 9 * W + 2;
  const h = 8 * 1.5 * R + 2 * R + 2;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={size} height={(size * h) / w} aria-hidden="true">
      {spaces.map((s) => {
        const cx = (s.x - Math.abs(4 - s.y) / 2) * W + W / 2 + 1;
        const cy = s.y * 1.5 * R + R + 1;
        const ocean = s.spaceType === 'ocean';
        const pole = s.bonus.includes(5);
        return (
          <g key={s.id}>
            <path d={hex(cx, cy, R - 0.5)} fill={ocean ? '#2F82C0' : '#7A3A22'} opacity={ocean ? 0.95 : 0.8} />
            {s.volcanic && <path d={hex(cx, cy, R - 2.2)} fill="none" stroke="#F0643A" strokeWidth={0.9} />}
            {pole && <circle cx={cx} cy={cy} r={1.8} fill="#EAF2F4" />}
          </g>
        );
      })}
    </svg>
  );
}

const CHOICES: BoardChoice[] = [...BOARD_NAMES, 'random'];

export function BoardPick({value, onChange}: {value: BoardChoice; onChange: (b: BoardChoice) => void}) {
  const shown = value === 'random' ? null : BOARDS[value];
  return (
    <div style={{padding: '12px 14px 14px', borderRadius: 16, background: 'rgba(0,0,0,.35)', backdropFilter: 'blur(8px)'}}>
      <div style={{display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10}}>
        <strong style={{fontWeight: 650}}>Map</strong>
        <span className="muted" style={{fontSize: 13}}>for the whole table</span>
      </div>
      <div role="radiogroup" aria-label="Map" style={{display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6}}>
        {CHOICES.map((b) => {
          const on = value === b;
          return (
            <motion.button key={b} role="radio" aria-checked={on} data-board={b} whileTap={{scale: 0.95}} onClick={() => onChange(b)}
              style={{position: 'relative', display: 'grid', justifyItems: 'center', gap: 4, padding: '8px 2px 6px', borderRadius: 12,
                background: on ? 'rgba(242,194,48,.12)' : 'rgba(255,255,255,.04)'}}>
              {on && <motion.span layoutId="board-ring" transition={{type: 'spring', stiffness: 420, damping: 34}}
                style={{position: 'absolute', inset: 0, borderRadius: 12, boxShadow: 'inset 0 0 0 1.5px var(--mc)'}} />}
              {b === 'random'
                ? <RandomGlyph />
                : <MiniMap board={b} size={62} />}
              <span className="cond" style={{fontSize: 13.5, fontWeight: 650, color: on ? 'var(--ice)' : 'var(--ice-dim)'}}>
                {b === 'random' ? 'Random' : BOARDS[b].title}
              </span>
            </motion.button>
          );
        })}
      </div>
      <AnimatePresence mode="wait">
        <motion.div key={value} initial={{opacity: 0, y: 6}} animate={{opacity: 1, y: 0}} exit={{opacity: 0, y: -6}} transition={{duration: 0.18}}
          style={{marginTop: 10, fontSize: 13.5}}>
          {shown ? (
            <>
              <div className="muted">{shown.blurb}</div>
              <div style={{marginTop: 6}}><span className="faint">Milestones </span>{shown.milestones.map((m) => m.name).join(', ')}</div>
              <div><span className="faint">Awards </span>{shown.awards.map((a) => a.name).join(', ')}</div>
            </>
          ) : <div className="muted">One of the three maps, drawn when the game starts and announced on the TV.</div>}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

export function RandomGlyph({size = 62}: {size?: number}) {
  return (
    <svg width={size} height={size * 0.88} viewBox="0 0 62 55" aria-hidden="true">
      <g transform="translate(31 27.5) rotate(-12)">
        <rect x={-15} y={-15} width={30} height={30} rx={7} fill="rgba(234,242,244,.14)" stroke="rgba(234,242,244,.55)" strokeWidth={1.4} />
        {[[-7, -7], [7, 7], [0, 0], [7, -7], [-7, 7]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r={2.6} fill="var(--mc)" />)}
      </g>
    </svg>
  );
}
