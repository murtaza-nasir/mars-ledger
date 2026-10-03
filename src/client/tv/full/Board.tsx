// The Tharsis board: a disc of Mars carrying the hex field. Memoized geometry; tiles and ghosts animate.
import {DiscLight} from '../weather/Sky';
import type {SkyLight} from '../weather/sky';
import {AnimatePresence, animate, motion, useMotionValue, useReducedMotion} from 'motion/react';
import {memo, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {BoardTypeContext, fitText} from './boardType';
import type {BoardType} from './boardType';
import {TEXT_SCALE, useTvSettings} from '../settings';
import {BONUS_NAME} from '../../../shared/full';
import {HELLAS_BONUS_OCEAN_COST} from '../../../shared/board';
import type {Hover, SpaceModel} from '../../../shared/full';
import {Claim, Defs, Ghost, Tile} from './Tiles';
import {FlatEchoes} from './EchoHex';
import {HEX_R, HEX_W, hexPoints, layout, offMapAt} from './geometry';
import {cameraTarget, LIVE, STORY} from './camera';

const SPACE = hexPoints(HEX_R - 2.5);

const INNER = hexPoints(HEX_R - 8);

function BonusGlyph({b}: {b: string}) {
  switch (b) {
  case 'steel':
    return <g><path d="M-8 -4 0 -9 8 -4v8L0 9-8 4z" fill="#B07A45" /><path d="M-8 -4 0 1 8-4M0 1v8" stroke="#3B2410" strokeWidth="1" fill="none" opacity=".6" /></g>;
  case 'titanium':
    return <g><path d="M-8 -4 0 -9 8 -4v8L0 9-8 4z" fill="#2E313B" stroke="#9AA3B8" strokeWidth="1" /><path d="m0 -5 1.4 2.9 3.2.4-2.3 2.2.6 3.1L0 2.1-2.9 3.6l.6-3.1-2.3-2.2 3.2-.4z" fill="#F2C230" /></g>;
  case 'plants':
    return <g><path d="M0 9c-5-3-7-7-6-13 5 0 9 3 9 8M0 9c4-2 6-6 6-11-3 0-6 2-6 5" fill="#5BBE6A" /></g>;
  case 'card':
    return <g><rect x={-6} y={-8.5} width={12} height={17} rx={2} fill="#EAF2F4" stroke="#8C5A3A" strokeWidth={1.2} /><rect x={-3.5} y={-5.5} width={7} height={3} fill="#8C5A3A" /></g>;
  case 'heat':
    return <path d="M0 -9c1 3.5 5.5 5.5 5.5 10.5a5.5 5.5 0 0 1-11 0c0-2.5 1.3-4 2.3-5 .2 1.8.9 2.8 2 3.3C-1.6 5-1-6-0-9z" fill="#F0643A" />;
  case 'ocean':
    return <path d="M0 -9C3 -4 6 0 6 3.5a6 6 0 0 1-12 0C-6 0-3-4 0-9z" fill="#2F82C0" />;
  case 'megacredits':
    return <g><rect x={-8} y={-8} width={16} height={16} rx={3} fill="#F2C230" /><path d="M-4 4V-3l4 4 4-4v7" stroke="#3A2503" strokeWidth="1.8" fill="none" /></g>;
  default:
    return null;
  }
}

export const SpaceBase = memo(function SpaceBase({s, t}: {s: SpaceModel; t: BoardType}) {
  const ocean = s.spaceType === 'ocean';
  const gs = t.icon;
  const bonuses = s.bonus.map((b) => BONUS_NAME[b]).filter(Boolean) as string[];
  const n = bonuses.length;
  return (
    <g>
      <polygon points={SPACE} fill={ocean ? 'url(#s-ocean)' : 'url(#s-land)'} stroke={ocean ? 'rgba(47,130,192,.55)' : 'rgba(255,196,160,.16)'} strokeWidth={1.4} />
      {ocean && <polygon points={INNER} fill="none" stroke="rgba(47,130,192,.45)" strokeWidth={1.2} strokeDasharray="4 4" />}
      {s.highlight === 'volcanic' && <path d="M-7 -30 0 -38 7 -30z" fill="#E2502E" opacity={0.75} />}
      {bonuses.map((b, i) => (
        <g key={i} transform={`translate(${(i - (n - 1) / 2) * 18.5 * gs} ${(ocean ? 4 : 2) - (bonuses.includes('ocean') ? 12 : 0)}) scale(${gs})`} opacity={0.92}><BonusGlyph b={b} /></g>
      ))}
      {/* Hellas south pole: a tile here lets its owner buy an extra ocean */}
      {bonuses.includes('ocean') && (
        <text y={31} textAnchor="middle" fill="#F2C230" style={{font: `700 ${fitText(t, 4, 50, 0.48).toFixed(1)}px 'Saira Variable'`, fontVariationSettings: "'wdth' 80"}}>{HELLAS_BONUS_OCEAN_COST} M€</text>
      )}
    </g>
  );
});

/** Camera brief: the spaces to look toward (empty = the whole board), whether moves are allowed now, and the pace. */
export type CameraBrief = {focus: string[]; enabled: boolean; mode?: 'live' | 'story'};

type Props = {spaces: SpaceModel[]; fresh: Set<string>; hovers: Hover[]; names: Record<string, string>; progress: number; camera?: CameraBrief;
  /** the day's light on the disc; drawn beneath the hex field */
  light?: SkyLight;
  /** what fills the box: the whole planet disc (default), or the map, with the disc reaching past the box */
  fill?: 'plate' | 'map'};

// Springs keep velocity when the target moves, so a second placement mid-move retargets without a snap.
const SPRING = {live: {type: 'spring', stiffness: 38, damping: 15, mass: 1}, story: {type: 'spring', stiffness: 9, damping: 8, mass: 1}} as const;

/** Drives the lens. The moving layers are HTML wrappers moved by CSS transform, so the GPU compositor does the
 *  work (an SVG group transform would repaint the whole board every frame). Board units become pixels with the
 *  measured scale k; will-change is on only while moving, so the board re-renders sharp once the camera settles. */
function useCamera(brief: CameraBrief | undefined, pos: Map<string, {cx: number; cy: number}>, discR: number, extent: number, k: number) {
  const reduced = useReducedMotion();
  const x = useMotionValue(0), y = useMotionValue(0), s = useMotionValue(1);
  const layers = useRef<Array<HTMLDivElement | null>>([]);
  const kRef = useRef(k);
  kRef.current = k;
  const points = (brief?.focus ?? []).map((id) => pos.get(id)).filter(Boolean).map((c) => ({x: c!.cx, y: c!.cy}));
  const mode = brief?.mode ?? 'live';
  const target = cameraTarget(points, {discR, extent, enabled: !!brief?.enabled && !reduced, ...(mode === 'story' ? STORY : LIVE)});
  const key = `${target.x.toFixed(1)},${target.y.toFixed(1)},${target.scale.toFixed(4)}`;
  // Test hook (like window.__net): the current brief and target, for the TV checks.
  (window as unknown as {__cam?: unknown}).__cam = {mode, enabled: !!brief?.enabled, reduced, focus: brief?.focus ?? [], points: points.length, target};
  const paint = () => {
    const kk = kRef.current;
    const t = `translate(${(x.get() * kk).toFixed(2)}px, ${(y.get() * kk).toFixed(2)}px) scale(${s.get().toFixed(4)})`;
    for (const el of layers.current) if (el) el.style.transform = t;
  };
  useEffect(() => {
    const off = [x.on('change', paint), y.on('change', paint), s.on('change', paint)];
    paint();
    return () => off.forEach((f) => f());
  }, [x, y, s]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(paint, [k]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (reduced) { x.jump(0); y.jump(0); s.jump(1); return; }
    const t = SPRING[mode];
    const at = {x: x.get(), y: y.get(), s: s.get()};
    if (Math.abs(at.x - target.x) < 0.05 && Math.abs(at.y - target.y) < 0.05 && Math.abs(at.s - target.scale) < 1e-4) return;
    for (const el of layers.current) if (el) el.style.willChange = 'transform';
    const runs = [animate(x, target.x, t), animate(y, target.y, t), animate(s, target.scale, t)];
    let live = true;
    Promise.all(runs.map((r) => r.finished)).then(() => {
      // settled: let the browser re-render the layers at their final scale (sharp text and edges)
      if (live) for (const el of layers.current) if (el) el.style.willChange = 'auto';
    }).catch(() => {});
    return () => { live = false; runs.forEach((r) => r.stop()); };
  }, [key, reduced, mode]); // eslint-disable-line react-hooks/exhaustive-deps
  return (i: number) => (el: HTMLDivElement | null) => { layers.current[i] = el; };
}

/** How far the flat board's drawing reaches past its box on each side when the map fills the box (a share of the box). */
const MAP_BLEED = 0.2;

const FILL: React.CSSProperties = {position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible'};

export function Board({spaces, fresh, hovers, names, progress, camera, light, fill = 'plate'}: Props) {
  const geo = useMemo(() => layout(spaces), [spaces.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const byId = useMemo(() => new Map(spaces.map((s) => [s.id, s])), [spaces]);
  const pos = useMemo(() => new Map(geo.cells.map((c) => [c.id, c])), [geo]);
  const discR = geo.width * 0.6;
  // farthest drawn content from the centre: the outermost hex centre plus its circumradius
  const extent = useMemo(() => Math.max(0, ...geo.cells.map((c) => Math.hypot(c.cx, c.cy))) + HEX_R, [geo]);
  // the plate: the disc's width (sized to hold Ganymede and Phobos beside the map); the map: the hex field and
  // the off-map spaces in its top corners, with a hair of room
  // (map: the drawing reaches MAP_BLEED past the box on every side, so the disc is drawn whole under the columns; the
  // same share on both axes keeps the map fitted to the box itself)
  const bleed = fill === 'map' ? 1 + 2 * MAP_BLEED : 1;
  const vbW = (fill === 'map' ? geo.width + HEX_W * 0.3 : geo.width + HEX_W * 1.8) * bleed;
  const vbH = (fill === 'map' ? geo.height + HEX_R * 0.6 : geo.height + HEX_R * 1.4) * bleed;
  const viewBox = `${-vbW / 2} ${-vbH / 2} ${vbW} ${vbH}`;
  // pixels per board unit, as the SVG layers draw it (viewBox scaled to fit, centred)
  const root = useRef<HTMLDivElement>(null);
  const [k, setK] = useState(1);
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const measure = () => setK(Math.min(el.clientWidth / vbW, el.clientHeight / vbH) || 1);
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, [vbW, vbH]);
  const layer = useCamera(camera, pos, discR, extent, k);
  const {textSize} = useTvSettings();
  const [screenH, setScreenH] = useState(() => window.innerHeight);
  useEffect(() => {
    const r = () => setScreenH(window.innerHeight);
    window.addEventListener('resize', r);
    return () => window.removeEventListener('resize', r);
  }, []);
  const type = useMemo<BoardType>(() => {
    const f = TEXT_SCALE[textSize];
    const px = (pct: number) => (pct / 100) * screenH / (k || 1);
    // bonus glyphs are 18 units tall at scale 1: at least 1.7% of the screen, grown with the text size, at most 1.3
    const icon = Math.min(1.3, Math.max(1.05, px(1.7) / 18) * Math.max(1, f / 1.15));
    return {text: px(1.65 * f), min: px(1.6), icon};
  }, [textSize, screenH, k]);
  // The disc warms from dust to a living world as the parameters rise.
  const rim = `color-mix(in oklab, #C1582E ${Math.round((1 - progress) * 100)}%, #3F8FC8)`;
  const offMap = geo.offMap.map((s, i) => ({s, ...offMapAt(i)}));
  // The camera is a lens inside the disc: the terrain and the hex field move; the disc, its rim, its shading and
  // the off-map spaces stay put. Each moving layer is clipped to the disc by a static parent.
  const lens: React.CSSProperties = {...FILL, clipPath: `circle(${(discR * k).toFixed(1)}px at 50% 50%)`};
  const moving: React.CSSProperties = {...FILL, transformOrigin: '50% 50%'};

  return (
    <BoardTypeContext.Provider value={type}>
    <div ref={root} role="img" aria-label="Mars board" style={{isolation: 'isolate', ...(fill === 'map'
      ? {position: 'absolute', left: `${-MAP_BLEED * 100}%`, top: `${-MAP_BLEED * 100}%`, width: `${bleed * 100}%`, height: `${bleed * 100}%`}
      : {position: 'relative', width: '100%', height: '100%'})}}>
      <svg viewBox={viewBox} style={FILL} aria-hidden="true">
        <Defs />
        <defs>
          <radialGradient id="disc-shade" cx="0.4" cy="0.36" r="0.72">
            <stop offset="0.55" stopColor="#000" stopOpacity="0" /><stop offset="1" stopColor="#0E0604" stopOpacity="0.75" />
          </radialGradient>
          <radialGradient id="disc" cx="0.42" cy="0.38" r="0.7">
            <stop offset="0" stopColor="#7A3A22" /><stop offset="0.6" stopColor="#4A2218" /><stop offset="1" stopColor="#24130F" />
          </radialGradient>
        </defs>
        <motion.circle r={discR} fill="url(#disc)" animate={{stroke: rim}} strokeWidth={6} strokeOpacity={0.5} transition={{duration: 3}} />
      </svg>

      {/* Real terrain (NASA Viking mosaic) washed into the disc so the hexes sit on Mars, not on a brown plate. */}
      <div style={{...lens, mixBlendMode: 'overlay', opacity: 0.42}}>
        <div ref={layer(0)} data-camera-layer="terrain" style={moving}>
          <svg viewBox={viewBox} style={FILL} aria-hidden="true">
            <image href="/assets/mars-color.jpg" x={-discR * 1.6} y={-discR} width={discR * 4} height={discR * 2} preserveAspectRatio="none" />
          </svg>
        </div>
      </div>

      <svg viewBox={viewBox} style={FILL} aria-hidden="true">
        <circle r={discR} fill="url(#disc-shade)" />
        <circle r={discR + 24} fill="none" stroke="rgba(255,196,160,.06)" strokeWidth={40} />
      </svg>

      {/* the day's light falls on the planet, beneath the hexes, so tiles and their text keep their colours */}
      {light && <DiscLight light={light} clip={`circle(${(discR * k).toFixed(1)}px at 50% 50%)`} />}

      <div style={lens}>
        <div ref={layer(1)} data-camera-layer="board" style={moving}>
          <svg viewBox={viewBox} style={FILL} aria-hidden="true">
            {geo.cells.map((c) => (
              <g key={c.id} data-space={c.id} transform={`translate(${c.cx} ${c.cy})`}><SpaceBase s={c.space} t={type} /></g>
            ))}
            {geo.cells.filter((c) => { const s = byId.get(c.id); return s?.tileType === undefined && s?.color && s.color !== 'neutral'; }).map((c) => (
              <g key={`c${c.id}`} transform={`translate(${c.cx} ${c.cy})`}><Claim color={byId.get(c.id)!.color!} /></g>
            ))}
            {geo.cells.filter((c) => byId.get(c.id)?.tileType !== undefined).map((c) => {
              const s = byId.get(c.id)!;
              return <g key={`t${c.id}`} transform={`translate(${c.cx} ${c.cy})`}><Tile tileType={s.tileType!} color={s.color} fresh={fresh.has(c.id)} /></g>;
            })}
            <AnimatePresence>
              {hovers.filter((h) => h.spaceId && pos.has(h.spaceId)).map((h) => {
                const c = pos.get(h.spaceId!)!;
                return (
                  <motion.g key={h.playerId} data-ghost={h.spaceId} transform={`translate(${c.cx} ${c.cy})`} exit={{opacity: 0}} transition={{duration: 0.2}}>
                    <Ghost color={h.color} tile={h.tile} name={names[h.playerId] ?? ''} />
                  </motion.g>
                );
              })}
            </AnimatePresence>
            {/* map echo: a phone asked the TV to point at these spaces */}
            <FlatEchoes pos={pos} />
          </svg>
        </div>
      </div>

      <svg viewBox={viewBox} style={FILL} aria-hidden="true">
        {offMap.map(({s, cx, cy}) => (
          <g key={s.id} transform={`translate(${cx} ${cy})`}>
            <circle r={HEX_R * 1.05} fill="none" stroke="rgba(255,196,160,.22)" strokeDasharray="3 5" />
            <polygon points={SPACE} fill="rgba(0,0,0,.25)" stroke="rgba(255,196,160,.18)" />
            <text textAnchor="middle" y={HEX_R + 8 + type.text} fill="rgba(234,242,244,.62)" style={{font: `600 ${type.text.toFixed(1)}px 'Saira Variable'`, fontVariationSettings: "'wdth' 75"}}>
              {s.id === '02' ? 'Phobos' : 'Ganymede'}
            </text>
            {byId.get(s.id)?.tileType !== undefined && <Tile tileType={byId.get(s.id)!.tileType!} color={byId.get(s.id)!.color} fresh={fresh.has(s.id)} />}
          </g>
        ))}
      </svg>
    </div>
    </BoardTypeContext.Provider>
  );
}
