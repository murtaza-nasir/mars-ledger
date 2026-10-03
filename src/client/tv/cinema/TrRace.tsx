// The terraform-rating race: one line per player across generations, drawn in as it plays.
import {motion} from 'motion/react';
import {useMemo} from 'react';
import type {Color} from '../../../shared/full';
import {PLAYER_HEX} from '../../ui/Icons';

type Series = {color: Color; name: string; points: Array<{generation: number; tr: number}>};

const W = 1000;
const H = 460;
const PAD = {l: 64, r: 250, t: 28, b: 56};

export function TrRace({series, draw = 2.2, delay = 0, highlight}: {series: Series[]; draw?: number; delay?: number; highlight?: number}) {
  const geo = useMemo(() => {
    const maxGen = Math.max(1, ...series.flatMap((s) => s.points.map((p) => p.generation)));
    const all = series.flatMap((s) => s.points.map((p) => p.tr));
    const lo = Math.floor((Math.min(20, ...all) - 1) / 5) * 5;
    const hi = Math.ceil((Math.max(25, ...all) + 1) / 5) * 5;
    const x = (g: number) => PAD.l + (g / maxGen) * (W - PAD.l - PAD.r);
    const y = (tr: number) => PAD.t + (1 - (tr - lo) / (hi - lo)) * (H - PAD.t - PAD.b);
    const lines = series.map((s) => {
      const pts = s.points.map((p) => [x(p.generation), y(p.tr)] as const);
      // Gentle monotone curve through the points.
      let d = '';
      pts.forEach(([px, py], i) => {
        if (i === 0) { d = `M${px} ${py}`; return; }
        const [qx, qy] = pts[i - 1];
        const mx = (qx + px) / 2;
        d += ` C${mx} ${qy} ${mx} ${py} ${px} ${py}`;
      });
      const last = pts[pts.length - 1] ?? [x(0), y(20)];
      return {s, d, end: last, tr: s.points[s.points.length - 1]?.tr ?? 20};
    });
    // Labels must not collide: spread them vertically by at least 34 units.
    const labels = [...lines].sort((a, b) => a.end[1] - b.end[1]).map((l) => ({l, y: l.end[1]}));
    for (let i = 1; i < labels.length; i++) labels[i].y = Math.max(labels[i].y, labels[i - 1].y + 50);
    const over = labels.length ? labels[labels.length - 1].y - (H - PAD.b) : 0;
    if (over > 0) labels.forEach((l) => { l.y -= over; });
    const grid: number[] = [];
    for (let v = lo; v <= hi; v += 5) grid.push(v);
    return {lines, labels, grid, x, y, maxGen};
  }, [series]);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{width: '100%', height: '100%', overflow: 'visible'}} role="img" aria-label="Terraform rating by generation">
      <defs>
        <filter id="race-glow" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="5" /></filter>
      </defs>
      {geo.grid.map((v) => (
        <g key={v}>
          <line x1={PAD.l} x2={W - PAD.r} y1={geo.y(v)} y2={geo.y(v)} stroke="rgba(234,242,244,.08)" strokeWidth={1} />
          <text x={PAD.l - 12} y={geo.y(v) + 6} textAnchor="end" fill="rgba(234,242,244,.4)" style={{font: "600 24px 'Saira Variable'", fontVariationSettings: "'wdth' 80"}}>{v}</text>
        </g>
      ))}
      {Array.from({length: geo.maxGen + 1}, (_, g) => (
        <text key={g} x={geo.x(g)} y={H - 14} textAnchor="middle" fill={g === highlight ? 'rgba(242,194,48,.95)' : 'rgba(234,242,244,.4)'}
          style={{font: `${g === highlight ? 800 : 600} 24px 'Saira Variable'`, fontVariationSettings: "'wdth' 80"}}>{g === 0 ? 'start' : g}</text>
      ))}
      {highlight !== undefined && (
        <motion.rect x={geo.x(Math.max(0, highlight - 1))} y={PAD.t} width={geo.x(highlight) - geo.x(Math.max(0, highlight - 1))} height={H - PAD.t - PAD.b}
          fill="rgba(242,194,48,.07)" initial={{opacity: 0}} animate={{opacity: 1}} transition={{delay, duration: 0.6}} />
      )}
      {geo.lines.map(({s, d}, i) => (
        <g key={s.color}>
          <motion.path d={d} fill="none" stroke={PLAYER_HEX[s.color] ?? '#999'} strokeWidth={14} strokeLinecap="round" opacity={0.35} filter="url(#race-glow)"
            initial={{pathLength: 0}} animate={{pathLength: 1}} transition={{delay: delay + i * 0.08, duration: draw, ease: [0.3, 0.7, 0.2, 1]}} />
          <motion.path d={d} fill="none" stroke={PLAYER_HEX[s.color] ?? '#999'} strokeWidth={6.5} strokeLinecap="round" strokeLinejoin="round"
            initial={{pathLength: 0}} animate={{pathLength: 1}} transition={{delay: delay + i * 0.08, duration: draw, ease: [0.3, 0.7, 0.2, 1]}} />
        </g>
      ))}
      {geo.labels.map(({l, y}, i) => (
        <motion.g key={l.s.color} initial={{opacity: 0, x: -14}} animate={{opacity: 1, x: 0}} transition={{delay: delay + draw + i * 0.06, duration: 0.45}}>
          <motion.circle cx={l.end[0]} cy={l.end[1]} r={11} fill={PLAYER_HEX[l.s.color]} stroke="#1A0D0A" strokeWidth={4}
            // a scale pulse (motion left r undefined during the delay of an `r` keyframe animation: a console error)
            style={{transformBox: 'fill-box', transformOrigin: 'center'}} animate={{scale: [1, 16 / 11, 1]}} transition={{delay: delay + draw, duration: 1.4, repeat: 2}} />
          <line x1={l.end[0] + 12} y1={l.end[1]} x2={W - PAD.r + 18} y2={y} stroke={PLAYER_HEX[l.s.color]} strokeOpacity={0.5} strokeWidth={1.5} />
          <text x={W - PAD.r + 28} y={y + 13} fill="#EAF2F4" style={{font: "800 40px 'Saira Variable'", fontVariationSettings: "'wdth' 118"}}>{l.tr}</text>
          <text x={W - PAD.r + 104} y={y + 11} fill={PLAYER_HEX[l.s.color]} style={{font: "700 28px 'Saira Variable'", fontVariationSettings: "'wdth' 80"}}>
            {l.s.name.length > 9 ? l.s.name.slice(0, 8) + '…' : l.s.name}
          </text>
        </motion.g>
      ))}
    </svg>
  );
}
