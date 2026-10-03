// The 3D board: the map as raised hexes on a plate of Mars, lit by the generation's sky, with a
// camera that dollies and tilts toward a placement through a passing fog, then settles back to the 3/4 view.
// Hex tops carry the flat board's own drawings (atlas.tsx): a 3D model per tile kind stands on each (tiles3d.tsx).
import {Canvas, invalidate, useFrame, useLoader, useThree} from '@react-three/fiber';
import {useReducedMotion} from 'motion/react';
import {memo, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import * as THREE from 'three';
import {PLAYER_HEX} from '../../../ui/Icons';
import type {Color, Hover, SpaceModel} from '../../../../shared/full';
import {TILE, tileKind, TILE_NAME} from '../../../../shared/full';
import {SPECIAL_SHORT} from '../Tiles';
import {useNet} from '../../../net';
import {useCinema} from '../../cinema/queue';
import type {SkyLight} from '../../weather/sky';
import {setSettings, TEXT_SCALE, tileStyleOf, useTvSettings} from '../../settings';
import type {TileStyle} from '../../settings';
import type {BoardType} from '../boardType';
import {HEX_R, HEX_W} from '../geometry';
import {cellKey, cellMarkup, paintCell, texelsFor} from './atlas';
import {adjustedRest, cameraPosition, fallbackStep, FALLBACK, focusView, FOV, lensOf, MOMENT, momentView, moveAmount, refDist, REST_POLAR, restView, stepView, ZERO_VEL} from './camera3d';
import type {FrameRect, View, WindowStats} from './camera3d';
import {board3d, keepPoints, MODEL_TALL, PAD_LIFT, prismHeight, PRISM_R, restPoints, restScale, UNIT} from './geometry3d';
import type {Board3} from './geometry3d';
import {Atmosphere, DepthOfField, fogState, patchHeightFog} from './atmosphere';
import {cameraHold, ClaimFlag, holdCamera, kick, kickOffset, KICK, loadModels, ModelPrep, ModelWarmup, setTileDetail, setTileSet, tileDetail, tileSet, TILE_RENDERERS, world, WorldTicker} from './tiles3d';
import {lodStep, oceanEdgeMap, screenSize} from './tilesets';
import {FlyControls} from './FlyControls';
import {flyControls, landed, setRestInfo, useFly} from './flyStore';
import {floorAt, flyFrom, landEase, mixInputs, nearFor, stepFlight} from './flight';
import {FLY_STALE_MS} from '../../../../shared/fly';
import type {FlyBounds, FlyState, Obstacle} from './flight';
import type {Detail} from './tilesets';
import {usePipeline} from '../pipeline/store';
import {useEchoSpaces} from '../echoStore';

/** The flat board's camera brief, plus the latest big moment (a bonus step or a maximum), which flies over the
 *  board once the cinematic covering it has gone (or is dropped if that takes too long). */
export type Camera3Brief = {focus: string[]; enabled: boolean; mode?: 'live' | 'story'; moment?: {at: number; strength: 'step' | 'max'}};

export type Board3DProps = {
  spaces: SpaceModel[]; fresh: Set<string>; hovers: Hover[]; names: Record<string, string>; progress: number;
  camera?: Camera3Brief; light?: SkyLight;
  /** the TV could not hold the frame budget: switch to the flat board */
  onSlow: (stats: WindowStats) => void;
  /** the board is on screen (no cinematic or production show over it): only then do its frame times count */
  watch?: boolean;
  /** parts of the screen (viewport px) that something else covers, which the resting board keeps out of */
  avoid?: ScreenRect[];
};

/** A rectangle on screen, in viewport px. */
export type ScreenRect = {left: number; top: number; right: number; bottom: number};
/** Where the board's box sits on screen (the frame the resting board fills) and the screen's size, in viewport px. */
type Place = {left: number; top: number; width: number; height: number; vw: number; vh: number};

// ---- shared geometry --------------------------------------------------------------------------------------
const TOP_R = HEX_R - 2.5;
/** A hex top in the ground plane whose UVs match the cell texture (viewBox: one hex's bounding box). */
const TOP = (() => {
  const pos: number[] = [0, 0, 0];
  const uv: number[] = [0.5, 0.5];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 90);
    const bx = TOP_R * Math.cos(a), by = TOP_R * Math.sin(a);
    pos.push(bx * UNIT, 0, by * UNIT);
    uv.push(bx / HEX_W + 0.5, 1 - (by + HEX_R) / (2 * HEX_R));
  }
  const idx: number[] = [];
  for (let i = 0; i < 6; i++) idx.push(0, 1 + ((i + 1) % 6), 1 + i);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
})();
/** A unit-height open hex prism (scaled per space). Cylinder vertices sit on ±z, matching pointy-top hexes. */
const SIDE = (() => { const g = new THREE.CylinderGeometry(PRISM_R, PRISM_R * 1.04, 1, 6, 1, true); g.translate(0, 0.5, 0); return g; })();
const OUTLINE = new THREE.EdgesGeometry(new THREE.CylinderGeometry(PRISM_R * 1.01, PRISM_R * 1.01, 0.001, 6));
const RING = new THREE.RingGeometry(PRISM_R * 0.92, PRISM_R * 1.04, 6, 1);
/** A soft round falloff (opaque centre, clear edge) for the shadow an orbital pad casts on the plate. */
const PAD_SHADOW = (() => {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'); if (!g) return null;
  const r = g.createRadialGradient(32, 32, 4, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.55, 'rgba(255,255,255,.6)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();
RING.rotateX(-Math.PI / 2);

const SIDE_LAND = new THREE.MeshStandardMaterial({color: '#5A2A1C', roughness: 0.95});
const SIDE_OCEAN = new THREE.MeshStandardMaterial({color: '#1F3A52', roughness: 0.8});
const SIDE_TILE = new THREE.MeshStandardMaterial({color: '#3A2A26', roughness: 0.9});
/** Plain ground under each top: what shows when the painted top fades out on a close camera. */
const CAP = {land: '#56291C', ocean: '#1B2C3C', greenery: '#2E5528', city: '#3F434F', special: '#5E3A22'} as const;
const CAP_MATS = Object.fromEntries(Object.entries(CAP).map(([k, c]) => [k, new THREE.MeshStandardMaterial({color: c, roughness: 0.9})])) as
  Record<keyof typeof CAP, THREE.MeshStandardMaterial>;

/** Roughly the middle height of each kind's model, in hex radii (the camera aims there on a dive). */
const MODEL_MID = {city: 0.55, greenery: 0.3, ocean: 0, special: 0.4} as const;

/** Each tile's model group by space id: the special names test their line of sight against these (tagOccluded). */
const MODEL_GROUPS = new Map<string, THREE.Object3D>();

/** A model's solid parts in world space, one box per mesh (a single box round a whole model would also cover the
 *  air beside its towers): only meshes that write depth, so a pollen cloud, steam or a beacon's halo does not count
 *  as something that hides a name. */
function solidBoxes(g: THREE.Object3D, out: THREE.Box3[]): THREE.Box3[] {
  let n = 0;
  g.updateWorldMatrix(true, true);
  g.traverseVisible((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || (o as unknown as THREE.Sprite).isSprite) return;
    const mat = m.material as THREE.Material;
    if (!mat || Array.isArray(mat) || mat.depthWrite === false || (mat.transparent && mat.opacity < 0.5)) return;
    const b = out[n] ?? (out[n] = new THREE.Box3());
    if ((m as THREE.InstancedMesh).isInstancedMesh) { const im = m as THREE.InstancedMesh; im.computeBoundingBox(); b.copy(im.boundingBox!); }
    else { if (!m.geometry.boundingBox) m.geometry.computeBoundingBox(); b.copy(m.geometry.boundingBox!); }
    b.applyMatrix4(m.matrixWorld);
    n++;
  });
  out.length = n;
  return out;
}

/** Every hex's painted-top material. They turn transparent while they fade in a dive, which is another shader
 *  program; the depth-of-field step compiles that variant ahead (topVariants). */
const TOP_MATS = new Set<THREE.MeshStandardMaterial>();
function topVariants() {
  const flipped: THREE.MeshStandardMaterial[] = [];
  for (const m of TOP_MATS) if (m.map && !m.transparent) { m.transparent = true; m.needsUpdate = true; flipped.push(m); }
  return () => { for (const m of flipped) { m.transparent = false; m.needsUpdate = true; } };
}

// the canvas covers the whole screen (the planet lies under the columns and the log lane); its outer edges fade, so a
// close camera never shows a hard cut
const EDGE_MASK = 'linear-gradient(90deg, transparent, #000 3%, #000 97%, transparent), linear-gradient(180deg, transparent, #000 3%, #000 97%, transparent)';

// ---- pacing under full-screen moments ----------------------------------------------------------------------
/** How often the board draws: every frame; every other frame while the production show plays over it (the camera
 *  rests and the show's dim and particles cover it, so 30 fps there is not seen, and its GPU time goes to the show);
 *  not at all while the generation recap covers the screen (its panel is 97 % opaque): the canvas keeps its last
 *  frame. The first frame after a pause sees the whole pause as its frame time; everything clamps it. */
type Pace = 'full' | 'half' | 'paused';
function usePace(): Pace {
  const recap = useCinema((s) => s.current?.kind === 'recap');
  const show = useNet((s) => s.production);
  const [, tick] = useState(0);
  const now = Date.now();
  const showing = !!show && now >= show.localStart - 100 && now < show.localStart + show.durationMs;
  // re-render when the show starts and when it ends
  useEffect(() => {
    if (!show) return;
    const ids = [show.localStart - 100, show.localStart + show.durationMs].map((t) => t - Date.now()).filter((d) => d > 0)
      .map((d) => setTimeout(() => tick((n) => n + 1), d + 5));
    return () => ids.forEach(clearTimeout);
  }, [show]);
  // (test hook: window.__board3dPace reads what the board does now)
  const pace: Pace = recap ? 'paused' : showing ? 'half' : 'full';
  if (typeof window !== 'undefined') (window as unknown as {__board3dPace?: Pace}).__board3dPace = pace;
  return pace;
}

/** Asks for every other frame while the canvas draws on demand (frameloop "demand" keeps three's own clock, so the
 *  frame times stay real). */
function useManualFrames(pace: Pace) {
  useEffect(() => {
    if (pace !== 'half') return;
    let raf = 0, n = 0;
    const loop = () => { if (n++ % 2 === 0) invalidate(); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [pace]);
}

// ---- the component ----------------------------------------------------------------------------------------
/** Test hook state: tiles laid over the game's spaces, which of them play their build-in, and a forced sky. */
type Dress = {tiles: Record<string, {tileType: number; color?: Color}>; fresh: string[]; light?: SkyLight};

export default function Board3D(outer: Board3DProps) {
  const root = useRef<HTMLDivElement>(null);
  // test hook: window.__board3dDress(tiles, freshIds, light) shows every tile kind on demand, for screenshots
  const [dress, setDress] = useState<Dress | null>(null);
  useEffect(() => {
    (window as unknown as {__board3dDress?: unknown}).__board3dDress = (tiles: Dress['tiles'] | null, fresh: string[] = [], light?: SkyLight) =>
      setDress(tiles ? {tiles, fresh, light} : null);
  }, []);
  const props = useMemo<Board3DProps>(() => {
    if (!dress) return outer;
    return {...outer, spaces: outer.spaces.map((s) => (dress.tiles[s.id] ? {...s, ...dress.tiles[s.id], bonus: []} : s)),
      fresh: new Set([...outer.fresh, ...dress.fresh]), light: dress.light ?? outer.light};
  }, [outer, dress]);
  // The board's box is the frame the resting board fills; the canvas behind it covers the whole screen, so the planet
  // and the sky reach under the columns, which sit on top.
  const [place, setPlace] = useState<Place | null>(null);
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const m = () => {
      const r = el.getBoundingClientRect();
      const next = {left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height), vw: window.innerWidth, vh: window.innerHeight};
      setPlace((p) => (p && p.left === next.left && p.top === next.top && p.width === next.width && p.height === next.height && p.vw === next.vw && p.vh === next.vh ? p : next));
    };
    const ro = new ResizeObserver(m);
    ro.observe(el);
    window.addEventListener('resize', m);
    m();
    // the box can move without changing size (the columns are measured after the first layout)
    const t = setInterval(m, 1000);
    return () => { ro.disconnect(); window.removeEventListener('resize', m); clearInterval(t); };
  }, []);
  const size = {w: place?.width ?? 0, h: place?.height ?? 0};
  const geo = useMemo(() => board3d(props.spaces), [props.spaces.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const settings = useTvSettings();
  const {textSize, cameraMoves} = settings;
  const tileStyle = tileStyleOf(settings);
  // The tile set this screen draws; its model files load on first use (tiles keep their models until it is warm)
  useEffect(() => { setTileSet(tileStyle); void loadModels(tileStyle); }, [tileStyle]);
  useEffect(() => {
    // test hook: window.__board3dTiles('classic' | 'detailed') switches the tile style as the TV options would
    (window as unknown as {__board3dTiles?: unknown}).__board3dTiles = (t: TileStyle) => setSettings({tileStyle: t});
    // test hook: window.__tvSettings(patch) changes this screen's TV options as the panel would
    (window as unknown as {__tvSettings?: unknown}).__tvSettings = (patch: Parameters<typeof setSettings>[0]) => setSettings(patch);
  }, []);
  const reduced = useReducedMotion();
  const screenH = typeof window === 'undefined' ? 1080 : window.innerHeight;
  // Label sizes in board units for the textures: the chosen TV text size on screen at the far rows.
  const pts = useMemo(() => restPoints(geo), [geo]);
  const keep = useMemo(() => keepPoints(geo), [geo]);
  // what covers part of the frame, in frame coordinates (x, y from -1 to 1, y up), a little enlarged
  const avoidKey = JSON.stringify(outer.avoid ?? []);
  const avoid = useMemo<FrameRect[]>(() => {
    if (!place || !place.width || !place.height) return [];
    const fx = (x: number) => ((x - place.left) / place.width) * 2 - 1, fy = (y: number) => 1 - ((y - place.top) / place.height) * 2;
    return (JSON.parse(avoidKey) as ScreenRect[]).map((r) => ({x0: fx(r.left) - 0.02, x1: fx(r.right) + 0.02, y0: fy(r.bottom) - 0.02, y1: fy(r.top) + 0.02}))
      .filter((r) => r.x1 > -1 && r.x0 < 1 && r.y1 > -1 && r.y0 < 1);
  }, [place, avoidKey]);
  // the resting view fills the frame with the board (camera3d restView)
  const auto = useMemo(() => (size.w && size.h ? restView(pts, size.w / size.h, avoid) : null), [pts, size.w, size.h, avoid]);
  // experimental: the TV options' zoom and tilt, around the automatic framing; zooming in stops where a hex's middle
  // would leave the screen at the top or bottom, or the free region at the sides (keepPoints)
  const {boardView, boardZoom, boardTilt} = settings;
  const adjusted = useMemo(() => {
    if (!boardView || !place || !size.w || !size.h) return null;
    const ex = 0.01;
    const fx = (x: number) => ((x - place.left) / place.width) * 2 - 1, fy = (y: number) => 1 - ((y - place.top) / place.height) * 2;
    // top to bottom the whole screen; across, the free region between the columns (a hex may tuck half under one)
    const room = {x0: Math.max(fx(place.vw * ex), -1.06), x1: Math.min(fx(place.vw * (1 - ex)), 1.06), y0: fy(place.vh * (1 - ex)), y1: fy(place.vh * ex)};
    return adjustedRest(pts, size.w / size.h, avoid, {zoom: boardZoom, tilt: boardTilt}, room, keep);
  }, [boardView, boardZoom, boardTilt, place, pts, keep, size.w, size.h, avoid]);
  const rest = adjusted?.view ?? auto;
  useEffect(() => { setRestInfo(auto ? {autoTilt: Math.round((auto.polar * 180) / Math.PI), maxZoom: adjusted?.maxZoom ?? null, zoom: adjusted?.zoom ?? null} : null); },
    [auto, adjusted]);
  // label and texture sizes follow the automatic framing, so moving a slider never repaints the board's tops
  const scale = useMemo(() => (auto ? restScale(geo, auto, size.w, size.h) : null), [geo, auto, size.w, size.h]);
  const type = useMemo<BoardType | null>(() => {
    if (!scale) return null;
    const f = TEXT_SCALE[textSize];
    const px = (pct: number) => (pct / 100) * screenH / scale.pxPerUnit;
    const icon = Math.min(1.3, Math.max(1.05, px(1.7) / 18) * Math.max(1, f / 1.15));
    return {text: px(1.65 * f), min: px(1.6), icon};
  }, [scale, textSize, screenH]);
  // test hook: the board's label sizes on screen at the resting camera, on the farthest (smallest) row
  if (scale && type) (window as unknown as {__board3dType?: unknown}).__board3dType = {screenH, farTextPx: type.text * scale.pxPerUnit,
    farMinPx: type.min * scale.pxPerUnit, farTextPct: (type.text * scale.pxPerUnit) / screenH * 100, hexPx: scale.hexPx, farHexPx: scale.pxPerUnit * 2 * HEX_R};
  const texSize = scale ? texelsFor(scale.hexPx * 1.75 * Math.min(2, window.devicePixelRatio || 1)) : 256;
  const labels = useRef(new Map<string, HTMLDivElement | null>());
  const labelPx = (1.65 / 100) * screenH * TEXT_SCALE[textSize];
  const offLabels = geo.offMap.map((o) => ({id: `off-${o.id}`, text: o.label}));
  const ghosts = props.hovers.filter((hv) => hv.spaceId && (geo.cells.some((c) => c.id === hv.spaceId) || geo.offMap.some((o) => o.id === hv.spaceId)));
  const moves = !!props.camera?.enabled && cameraMoves && !reduced;
  const pace = usePace();
  useManualFrames(pace);
  // special tiles' names ride over their models as HTML, so no model hides them; they fade when the camera dives in
  const specials = props.spaces.filter((s) => tileKind(s.tileType) === 'special')
    .map((s) => ({id: `sp-${s.id}`, text: SPECIAL_SHORT[s.tileType!] ?? (TILE_NAME[s.tileType!] ?? 'Special').split(' ')[0]}));

  // the canvas and its labels cover the screen; the frame is the board's box inside it, in canvas px
  const frame = place ? {x: place.left, y: place.top, w: place.width, h: place.height} : null;
  if (place && rest) (window as unknown as {__board3dFrame?: unknown}).__board3dFrame = {frame, screen: [place.vw, place.vh], rest, auto, adjusted, avoid};
  return (
    <div ref={root} role="img" aria-label="Mars board" data-board3d="" style={{position: 'relative', width: '100%', height: '100%'}}>
      {place && (
      <div data-board3d-stage="" style={{position: 'absolute', left: -place.left, top: -place.top, width: place.vw, height: place.vh, pointerEvents: 'none',
        maskImage: EDGE_MASK, WebkitMaskImage: EDGE_MASK, maskComposite: 'intersect', WebkitMaskComposite: 'source-in'}}>
      {size.w > 0 && type && rest && frame && (
        <Canvas shadows frameloop={pace === 'full' ? 'always' : 'demand'} dpr={Math.min(2, window.devicePixelRatio || 1)} gl={{antialias: true, alpha: true, powerPreference: 'high-performance'}}
          camera={{fov: FOV, near: 0.5, far: 120, position: cameraPosition(rest)}}
          style={{position: 'absolute', inset: 0}}>
          <Scene {...props} geo={geo} type={type} texSize={texSize} moves={moves} reduced={!!reduced} labels={labels} rest={rest} frame={frame} bank={settings.flyBank} />
        </Canvas>
      )}
      {/* labels drawn as HTML so they stay crisp; the scene moves them to their projected positions each frame */}
      {offLabels.map((l) => (
        <div key={l.id} ref={(el) => { labels.current.set(l.id, el); }} data-label={l.id}
          style={{position: 'absolute', left: 0, top: 0, transform: 'translate(-9999px, 0)', whiteSpace: 'nowrap', pointerEvents: 'none',
            font: `600 ${labelPx.toFixed(1)}px 'Saira Variable'`, fontVariationSettings: "'wdth' 75", color: 'rgba(234,242,244,.72)'}}>{l.text}</div>
      ))}
      {specials.map((l) => (
        <div key={l.id} ref={(el) => { labels.current.set(l.id, el); }} data-special-label={l.id.slice(3)}
          style={{position: 'absolute', left: 0, top: 0, transform: 'translate(-9999px, 0)', whiteSpace: 'nowrap', pointerEvents: 'none',
            opacity: 0, padding: `${(labelPx * 0.12).toFixed(1)}px ${(labelPx * 0.55).toFixed(1)}px`, borderRadius: 999, background: 'rgba(12,5,3,.72)',
            font: `650 ${(labelPx * 0.85).toFixed(1)}px 'Saira Variable'`, fontVariationSettings: "'wdth' 80", color: '#F5E6CF'}}>{l.text}</div>
      ))}
      {ghosts.map((hv) => {
        const c = PLAYER_HEX[hv.color] ?? '#fff';
        const text = `${props.names[hv.playerId] ?? ''}${hv.tile ? ` · ${hv.tile}` : ''}`;
        return (
          <div key={hv.playerId} ref={(el) => { labels.current.set(`ghost-${hv.playerId}`, el); }} data-ghost-label={hv.spaceId}
            style={{position: 'absolute', left: 0, top: 0, transform: 'translate(-9999px, 0)', whiteSpace: 'nowrap', pointerEvents: 'none',
              padding: `${(labelPx * 0.18).toFixed(1)}px ${(labelPx * 0.7).toFixed(1)}px`, borderRadius: 999, background: 'rgba(12,5,3,.88)',
              boxShadow: `inset 0 0 0 1.5px ${c}`, color: '#EAF2F4', font: `650 ${labelPx.toFixed(1)}px 'Saira Variable'`}}>{text}</div>
        );
      })}
      </div>
      )}
      {/* experimental: Fly over Mars (keys, mouse, gamepad and the phone's sticks; the hint while flying) */}
      <FlyControls enabled={settings.fly} placing={ghosts.map((g) => `${g.playerId}:${g.spaceId}`).join(',')} reduced={!!reduced} />
    </div>
  );
}

// ---- the scene ----------------------------------------------------------------------------------------------
/** The board's box inside the canvas, in canvas px: the resting view fills it. */
type Frame = {x: number; y: number; w: number; h: number};
type SceneProps = Board3DProps & {geo: Board3; type: BoardType; texSize: number; moves: boolean; reduced: boolean;
  labels: React.MutableRefObject<Map<string, HTMLDivElement | null>>; rest: View; frame: Frame; bank: boolean};

function Scene({spaces, fresh, hovers, progress, camera, light, onSlow, watch = true, geo, type, texSize, moves, reduced, labels, rest, frame, bank}: SceneProps) {
  const byId = useMemo(() => new Map(spaces.map((s) => [s.id, s])), [spaces]);
  const textures = useCellTextures(spaces, type, texSize);
  // test hook: the drawing a space's top is painted from
  (window as unknown as {__board3dSvg?: unknown}).__board3dSvg = (id: string) => { const sp = byId.get(id); return sp ? cellMarkup(sp, type) : null; };
  const night = light?.night ?? 0;
  const oceanEdges = useOceanEdges(geo, byId);
  return (
    <>
      <Rig geo={geo} spaces={byId} camera={camera} moves={moves} hovers={hovers} labels={labels} onSlow={onSlow} watch={watch} textures={textures.size} rest={rest} frame={frame}
        reduced={reduced} bank={bank} />
      <Lights light={light} />
      {/* a build-in waits ~0.8 s for the camera's dive when the camera moves; it starts at once when it stays put */}
      <WorldTicker night={night} reduced={reduced} lead={moves ? 0.8 : 0} />
      <Plate geo={geo} progress={progress} />
      {/* the move pipeline's targeting reticle (Phase 4): pings a hex before its tile drops */}
      <Reticle geo={geo} byId={byId} />
      {geo.cells.map((c) => {
        const s = byId.get(c.id) ?? c.space;
        return <Hex key={c.id} id={c.id} x={c.x} z={c.z} s={s} tex={textures.get(c.id)} fresh={fresh.has(c.id)} night={night} oceanEdges={oceanEdges.get(c.id)} />;
      })}
      {geo.offMap.map((o) => {
        const s = byId.get(o.id) ?? o.space;
        return (
          <group key={o.id} position={[o.x, 0.32, o.z]}>
            {/* off Mars: a solid dark deck the planet's rim passes under, and its soft shadow on the plate below, so the
                slot reads as a platform hovering in space rather than a mark on the planet */}
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.006, 0]}>
              <circleGeometry args={[PRISM_R * 1.23, 64]} />
              <meshBasicMaterial color="#2A1A14" fog={false} />
            </mesh>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[PRISM_R * 0.12, -0.32 + 0.008, PRISM_R * 0.18]} renderOrder={1}>
              <circleGeometry args={[PRISM_R * 1.5, 48]} />
              <meshBasicMaterial map={PAD_SHADOW} color="#000" transparent opacity={0.55} depthWrite={false} fog={false} />
            </mesh>
            {/* an orbital slot: a faint lit pad with a dashed ring, like the flat board's off-map circle */}
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.002, 0]}>
              <ringGeometry args={[PRISM_R * 1.18, PRISM_R * 1.23, 64]} />
              <meshBasicMaterial color="#FFC4A0" transparent opacity={0.3} depthWrite={false} fog={false} />
            </mesh>
            {s.tileType !== undefined
              ? <Hex id={o.id} x={0} z={0} s={s} tex={textures.get(o.id)} fresh={fresh.has(o.id)} night={night} />
              : <>
                <mesh geometry={TOP}><meshBasicMaterial color="#FFC4A0" transparent opacity={0.07} depthWrite={false} /></mesh>
                <lineSegments geometry={OUTLINE}><lineBasicMaterial color="#FFC4A0" transparent opacity={0.4} /></lineSegments>
              </>}
          </group>
        );
      })}
      {hovers.map((hv) => {
        const c = geo.cells.find((x) => x.id === hv.spaceId) ?? geo.offMap.find((x) => x.id === hv.spaceId);
        if (!c) return null;
        const lift = 'label' in c ? 0.32 : 0;
        return <Ghost key={hv.playerId} x={c.x} z={c.z} y={lift + prismHeight(byId.get(c.id) ?? c.space)} color={hv.color} />;
      })}
      {/* map echo: a phone asked the TV to point at these spaces */}
      <EchoGlows geo={geo} byId={byId} reduced={reduced} />
      {/* Fog decks the dive passes through, low mist, light shafts; then the frame (with depth of field when down) */}
      <Atmosphere geo={geo} spaces={byId} />
      <ModelWarmup radius={PRISM_R} />
      <ModelPrep />
      <DepthOfField enabled={!reduced} variants={topVariants} variantKey={textures.size ? 'tops' : ''} sceneKey={`${[...fresh].join(',')}|${spaces.map((s) => s.tileType ?? '').join(',')}`} />
    </>
  );
}

/** Each ocean tile's edges that border another ocean (ModelProps.oceanEdges), recomputed when tiles change. A tile
 *  keeps the same array while its edges stay the same, so only the oceans next to a new one re-render (and a
 *  re-render keeps the model mounted: its build-in carries on). */
function useOceanEdges(geo: Board3, byId: Map<string, SpaceModel>): Map<string, readonly boolean[]> {
  const cache = useRef(new Map<string, {key: string; edges: readonly boolean[]}>());
  const sig = geo.cells.map((c) => ((byId.get(c.id) ?? c.space).tileType === TILE.OCEAN ? '1' : '0')).join('');
  return useMemo(() => {
    const raw = oceanEdgeMap(geo.cells.map((c, i) => ({id: c.id, x: c.x, z: c.z, ocean: sig[i] === '1'})));
    const out = new Map<string, readonly boolean[]>();
    for (const [id, e] of raw) {
      const key = e.map(Number).join('');
      const hit = cache.current.get(id);
      const edges = hit && hit.key === key ? hit.edges : e;
      cache.current.set(id, {key, edges});
      out.set(id, edges);
    }
    // test hook: each ocean tile's edges as 0/1 strings
    (window as unknown as {__board3dOceanEdges?: unknown}).__board3dOceanEdges = Object.fromEntries([...out].map(([id, e]) => [id, e.map(Number).join('')]));
    return out;
  }, [geo, sig]);
}

/** Each space's top texture, repainted only when its drawing would change. */
function useCellTextures(spaces: SpaceModel[], type: BoardType, size: number): Map<string, THREE.CanvasTexture> {
  const [tex, setTex] = useState(() => new Map<string, THREE.CanvasTexture>());
  const keys = useRef(new Map<string, string>());
  const live = useRef(tex);
  live.current = tex;
  useEffect(() => {
    let cancelled = false;
    const todo = spaces.filter((s) => keys.current.get(s.id) !== cellKey(s, type, size));
    if (!todo.length) return;
    // fresh tiles first, so a placement's top is ready by the time its prism lands
    todo.sort((a, b) => Number(b.tileType !== undefined) - Number(a.tileType !== undefined));
    (async () => {
      const next = new Map(live.current);
      for (const s of todo) {
        if (cancelled) return;
        try {
          const t = await paintCell(s, type, size, next.get(s.id));
          next.set(s.id, t);
          keys.current.set(s.id, cellKey(s, type, size));
        } catch { /* one bad drawing must not stop the rest */ }
      }
      if (!cancelled) setTex(new Map(next));
    })();
    return () => { cancelled = true; };
  }, [spaces, type, size]);
  useEffect(() => () => { for (const t of live.current.values()) t.dispose(); }, []);
  (window as unknown as {__board3dTextures?: number}).__board3dTextures = tex.size;
  // test hook: what each space's top was painted from (compared with the engine model in the checks)
  (window as unknown as {__board3dKeys?: Map<string, string>}).__board3dKeys = keys.current;
  return tex;
}

// ---- pieces -------------------------------------------------------------------------------------------------
const Hex = memo(function Hex({id, x, z, s, tex, fresh, night, oceanEdges}: {id: string; x: number; z: number; s: SpaceModel; tex?: THREE.CanvasTexture; fresh: boolean; night: number; oceanEdges?: readonly boolean[]}) {
  const kind = tileKind(s.tileType);
  const height = prismHeight(s);
  const group = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  const Model = kind ? TILE_RENDERERS[kind].Model : undefined;
  // a tile with a model plays its own build-in (tiles3d.tsx); the plain prism drops in
  const born = useRef<number | null>(fresh && !Model ? performance.now() : null);
  useEffect(() => {
    if (!fresh) return;
    if (!Model) born.current = performance.now();
    if (kind) { kick(KICK[kind]); holdCamera(id, s.tileType!); }
  }, [fresh, s.tileType]); // eslint-disable-line react-hooks/exhaustive-deps
  const ringColor = s.color && s.color !== 'neutral' ? PLAYER_HEX[s.color as Color] ?? '#fff' : '#fff';
  const topMat = useMemo(() => new THREE.MeshStandardMaterial({roughness: 0.82, metalness: 0, color: '#ffffff'}), []);
  useEffect(() => { TOP_MATS.add(topMat); return () => { TOP_MATS.delete(topMat); topMat.dispose(); }; }, [topMat]);
  useEffect(() => {
    topMat.map = tex ?? null;
    // a little of the top lights itself, so labels and glyphs stay legible through the night
    topMat.emissive = new THREE.Color('#ffffff');
    topMat.emissiveMap = tex ?? null;
    topMat.emissiveIntensity = tex ? 0.32 : 0;
    topMat.color = new THREE.Color(tex ? '#ffffff' : s.spaceType === 'ocean' ? '#23384A' : '#5A2C1E');
    topMat.needsUpdate = true;
  }, [tex, topMat, s.spaceType]);
  useFrame(() => {
    // the painted top (labels, bonus icons) gives way to plain ground when the camera dives in
    const fade = world.topFade;
    const op = tex ? 1 - fade : 1;
    if (topMat.opacity !== op) { topMat.opacity = op; topMat.transparent = op < 0.999; topMat.visible = op > 0.01; }
    const g = group.current;
    if (!g) return;
    const t0 = born.current;
    if (t0 === null) { g.position.y = 0; if (ring.current) ring.current.visible = false; return; }
    const t = (performance.now() - t0) / 1000;
    // the tile drops in with a little bounce, then a ring in the owner's colour spreads from it
    const drop = Math.max(0, 1 - t / 0.55);
    g.position.y = 1.6 * drop * drop - (t > 0.55 && t < 0.8 ? Math.sin((t - 0.55) / 0.25 * Math.PI) * 0.03 : 0);
    const r = ring.current;
    if (r) {
      const k = Math.max(0, (t - 0.5) / 1.1);
      r.visible = k > 0 && k < 1;
      r.scale.setScalar(1 + k * 2.2);
      (r.material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - k);
    }
    if (t > 2) born.current = null;
  });
  return (
    <group position={[x, 0, z]} data-id={id}>
      <group ref={group}>
        <mesh geometry={SIDE} material={kind ? SIDE_TILE : s.spaceType === 'ocean' ? SIDE_OCEAN : SIDE_LAND} scale={[1, height, 1]} castShadow receiveShadow />
        <mesh geometry={TOP} material={CAP_MATS[kind ?? (s.spaceType === 'ocean' ? 'ocean' : 'land')]} position={[0, height + 0.0002, 0]} receiveShadow />
        <mesh geometry={TOP} material={topMat} position={[0, height + 0.0006, 0]} receiveShadow />
        {!kind && s.color && s.color !== 'neutral' && (
          <group position={[0, height + 0.0006, 0]}><ClaimFlag color={s.color as Color} R={PRISM_R} /></group>
        )}
        {Model && (
          <group position={[0, height + 0.0006, 0]} ref={(g) => { if (g) MODEL_GROUPS.set(id, g); else if (MODEL_GROUPS.get(id)) MODEL_GROUPS.delete(id); }}>
            <Model id={id} tileType={s.tileType!} color={s.color} fresh={fresh} radius={PRISM_R} top={height} night={night} oceanEdges={oceanEdges} />
          </group>
        )}
      </group>
      <mesh ref={ring} geometry={RING} position={[0, height + 0.01, 0]} visible={false}>
        <meshBasicMaterial color={ringColor} transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  );
});

function Ghost({x, z, y, color}: {x: number; z: number; y: number; color: Color}) {
  const c = PLAYER_HEX[color] ?? '#fff';
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(({clock}) => { if (mat.current) mat.current.opacity = 0.2 + 0.2 * (0.5 + 0.5 * Math.sin(clock.elapsedTime * 4.5)); });
  return (
    <group position={[x, y + 0.004, z]}>
      <mesh geometry={SIDE} scale={[1.02, 0.09, 1.02]}><meshBasicMaterial ref={mat} color={c} transparent opacity={0.3} depthWrite={false} /></mesh>
      <lineSegments geometry={OUTLINE} position={[0, 0.09, 0]}><lineBasicMaterial color={c} /></lineSegments>
    </group>
  );
}

/** Map echo: each space a phone asked about glows with a pulsing border and a soft column of light (still when reduced). */
function EchoGlows({geo, byId, reduced}: {geo: Board3; byId: Map<string, SpaceModel>; reduced: boolean}) {
  const spaces = useEchoSpaces((s) => s.spaces);
  return (
    <>
      {spaces.map((e) => {
        const c = geo.cells.find((x) => x.id === e.spaceId) ?? geo.offMap.find((x) => x.id === e.spaceId);
        if (!c) return null;
        const y = ('label' in c ? 0.32 : 0) + prismHeight(byId.get(c.id) ?? c.space);
        return <EchoGlow key={e.key} x={c.x} z={c.z} y={y} color={PLAYER_HEX[e.color as Color] ?? '#F2C230'} until={e.until} reduced={reduced} />;
      })}
    </>
  );
}

function EchoGlow({x, z, y, color, until, reduced}: {x: number; z: number; y: number; color: string; until: number; reduced: boolean}) {
  const ring = useRef<THREE.MeshBasicMaterial>(null);
  const line = useRef<THREE.LineBasicMaterial>(null);
  const beam = useRef<THREE.MeshBasicMaterial>(null);
  const born = useRef(performance.now());
  useFrame(() => {
    const t = (performance.now() - born.current) / 1000;
    // fades in over 0.25 s and out over the last 0.35 s; pulses once a second unless motion is reduced
    const fade = Math.min(1, t / 0.25, Math.max(0, (until - Date.now()) / 350));
    const p = reduced ? 0.8 : 0.5 + 0.5 * Math.sin(t * Math.PI * 2 - Math.PI / 2);
    if (ring.current) ring.current.opacity = fade * (0.45 + 0.5 * p);
    if (line.current) line.current.opacity = fade * (0.75 + 0.25 * p);
    if (beam.current) beam.current.opacity = fade * (0.1 + 0.14 * p);
    if (fade > 0) invalidate();
  });
  return (
    <group position={[x, y + 0.012, z]}>
      <mesh geometry={RING} scale={[1.12, 1, 1.12]}>
        <meshBasicMaterial ref={ring} color={color} transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} />
      </mesh>
      <lineSegments geometry={OUTLINE} scale={[1.1, 1, 1.1]} position={[0, 0.01, 0]}>
        <lineBasicMaterial ref={line} color="#FFF4E0" transparent opacity={0} />
      </lineSegments>
      <mesh geometry={SIDE} scale={[1.06, 0.55, 1.06]}>
        <meshBasicMaterial ref={beam} color={color} transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
    </group>
  );
}

function Plate({geo, progress}: {geo: Board3; progress: number}) {
  const color = useLoader(THREE.TextureLoader, '/assets/mars-color.jpg');
  useMemo(() => {
    color.colorSpace = THREE.SRGBColorSpace;
    color.wrapS = color.wrapT = THREE.RepeatWrapping;
    color.repeat.set(0.42, 0.84);
    color.offset.set(0.31, 0.08);
    color.anisotropy = 8;
  }, [color]);
  const rim = useMemo(() => new THREE.Color('#C1582E').lerp(new THREE.Color('#3F8FC8'), progress), [progress]);
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[geo.discR, 160]} />
        <meshStandardMaterial map={color} color="#9A6A58" roughness={1} />
      </mesh>
      <mesh position={[0, -0.16, 0]}>
        <cylinderGeometry args={[geo.discR, geo.discR * 0.94, 0.32, 160, 1, true]} />
        <meshStandardMaterial color="#2E1610" roughness={1} side={THREE.DoubleSide} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.004, 0]}>
        <ringGeometry args={[geo.discR * 0.985, geo.discR * 1.005, 160]} />
        <meshBasicMaterial color={rim} transparent opacity={0.55} />
      </mesh>
    </group>
  );
}

const DUSK = new THREE.Color('#FFB27A'), DAWN = new THREE.Color('#FFD6B0'), NOON = new THREE.Color('#FFE8D6'), NIGHT = new THREE.Color('#8EA0D8');

function Lights({light}: {light?: SkyLight}) {
  const key = useRef<THREE.DirectionalLight>(null);
  const amb = useRef<THREE.HemisphereLight>(null);
  const cur = useRef({dusk: 0, night: 0, dawn: 0});
  useFrame((_, dt) => {
    const want = light ?? {dusk: 0, night: 0, dawn: 0};
    const k = 1 - Math.exp(-dt * 0.8); // the same slow fade as the feature-12 sky
    cur.current = {dusk: cur.current.dusk + (want.dusk - cur.current.dusk) * k, night: cur.current.night + (want.night - cur.current.night) * k,
      dawn: cur.current.dawn + (want.dawn - cur.current.dawn) * k};
    const {dusk, night, dawn} = cur.current;
    fogState.night = night;
    fogState.still = !!world.reduced;
    const c = NOON.clone().lerp(DUSK, dusk * 0.8).lerp(DAWN, dawn * 0.6).lerp(NIGHT, night * 0.75);
    if (key.current) {
      key.current.color.copy(c);
      // nights are dark enough that the cities' windows and the specials' lights carry the scene
      key.current.intensity = 2.3 * (1 - 0.55 * night);
      // the sun comes from the west at dusk, the east at dawn
      key.current.position.set(-5 * dusk + 5 * dawn + (1 - dusk - dawn) * -2.5, 7, 4);
      fogState.sun.copy(key.current.position).normalize();
      fogState.sunColor.copy(c).multiplyScalar(1 - 0.6 * night);
    }
    if (amb.current) amb.current.intensity = 1.05 * (1 - 0.45 * night);
  });
  return (
    <>
      <hemisphereLight ref={amb} args={['#FFE2CC', '#3A1C14', 1.05]} />
      <directionalLight ref={key} position={[-2.5, 7, 4]} intensity={2.3} castShadow shadow-mapSize-width={2048} shadow-mapSize-height={2048}
        shadow-camera-left={-6} shadow-camera-right={6} shadow-camera-top={6} shadow-camera-bottom={-6} shadow-bias={-0.0006} />
    </>
  );
}

// (the fog lies low, thinning with height: patched into three's fog shader chunks before anything compiles)
patchHeightFog();

// dust haze by day, a blue-violet murk at night
const FOG_DAY = new THREE.Color('#C49A82'), FOG_NIGHT = new THREE.Color('#40395A');

/** Whether a special's name spot (its hex's front edge) is hidden from the camera by another tile's model: rays from
 *  the camera to the spot and to two points half a hex to either side (the pill is wider than a point) against the
 *  boxes of each model's solid meshes; hidden when two of the three are blocked. Boxes are refreshed every 0.5 s (models
 *  build and sway). Runs at most every 100 ms and only during a dive. */
const tagRay = new THREE.Ray(), tagHit = new THREE.Vector3(), tagP = new THREE.Vector3(), tagSide = new THREE.Vector3();
function tagOccluded(cam: THREE.Camera, id: string, x: number, y: number, z: number, boxes: Map<string, {boxes: THREE.Box3[]; at: number}>): boolean {
  const now = performance.now();
  tagSide.setFromMatrixColumn(cam.matrixWorld, 0).setY(0).normalize().multiplyScalar(PRISM_R * 0.5);
  let blocked = 0;
  for (const k of [0, -1, 1]) {
    tagP.set(x, y + 0.02, z).addScaledVector(tagSide, k);
    const dist = cam.position.distanceTo(tagP);
    tagRay.origin.copy(cam.position);
    tagRay.direction.copy(tagP).sub(cam.position).normalize();
    for (const [other, g] of MODEL_GROUPS) {
      if (other === id || !g.visible) continue;
      let b = boxes.get(other);
      if (!b || now - b.at > 500) { b = {boxes: solidBoxes(g, b?.boxes ?? []), at: now}; boxes.set(other, b); }
      if (b.boxes.some((box) => tagRay.intersectBox(box, tagHit) !== null && tagHit.distanceTo(cam.position) < dist - 0.02)) { blocked++; break; }
    }
    if (blocked >= 2) break;
  }
  return blocked >= 2;
}

// ---- level of detail ----------------------------------------------------------------------------------
type LodState = {changed: Map<string, number>; pos: THREE.Vector3; frustum: THREE.Frustum; m: THREE.Matrix4; sphere: THREE.Sphere};
/** Sets each tile's detail level for this frame: full when it is in focus or large on screen, lite otherwise, with
 *  hysteresis and at most a few switches per frame (tilesets.ts lodStep). Test hook: window.__board3dDetail = 'full' |
 *  'lite' forces one level on every tile. */
function updateLod(focusIds: string[], cam: THREE.Camera, geo: Board3, spaces: Map<string, SpaceModel>, st: LodState) {
  const now = performance.now();
  const forced = (window as unknown as {__board3dDetail?: Detail | null}).__board3dDetail;
  const pc = cam as THREE.PerspectiveCamera;
  pc.updateMatrixWorld();
  st.m.multiplyMatrices(pc.projectionMatrix, pc.matrixWorldInverse);
  st.frustum.setFromProjectionMatrix(st.m);
  const tiles: Parameters<typeof lodStep>[0] = [];
  let full = 0, placed = 0;
  for (const c of [...geo.cells, ...geo.offMap]) {
    const sp = spaces.get(c.id) ?? c.space;
    if (sp.tileType === undefined) continue;
    placed++;
    const detail = tileDetail(c.id);
    if (detail === 'full') full++;
    if (forced) { if (detail !== forced) setTileDetail(c.id, forced); continue; }
    const y = ('label' in c ? 0.32 : 0) + prismHeight(sp);
    st.pos.set(c.x, y, c.z);
    st.sphere.set(st.pos, PRISM_R * 1.6);
    tiles.push({id: c.id, detail, changedAt: st.changed.get(c.id) ?? -1e9, size: screenSize(PRISM_R, pc.position.distanceTo(st.pos), FOV),
      focused: focusIds.includes(c.id), onScreen: st.frustum.intersectsSphere(st.sphere)});
  }
  for (const {id, detail} of lodStep(tiles, now)) { setTileDetail(id, detail); st.changed.set(id, now); }
  (window as unknown as {__board3dLod?: unknown}).__board3dLod = {full, tiles: placed, last: tiles};
}

// ---- the camera rig, labels, fog and the frame-time watch ---------------------------------------------------
type RigProps = {geo: Board3; spaces: Map<string, SpaceModel>; camera?: Board3DProps['camera']; moves: boolean; hovers: Hover[];
  labels: React.MutableRefObject<Map<string, HTMLDivElement | null>>; onSlow: (stats: WindowStats) => void; watch: boolean; textures: number; rest: View; frame: Frame;
  reduced: boolean; bank: boolean};

/** The lens: FOV spans the frame's height and the view's centre sits at the frame's centre, while the canvas around
 *  it shows the rest of the world (an off-centre window on a larger image; fov is the canvas's, so anything that
 *  sizes points from fov and the canvas height stays right). */
function applyLens(cam: THREE.PerspectiveCamera, W: number, H: number, f: Frame, last: {key: string}) {
  const key = `${W}x${H}:${f.x},${f.y},${f.w},${f.h}`;
  if (key === last.key || !W || !H || !f.w || !f.h) return;
  last.key = key;
  const l = lensOf(W, H, f);
  cam.fov = l.fov;
  cam.aspect = l.aspect;
  cam.setViewOffset(...l.view);
}

function Rig({geo, spaces, camera, moves, hovers, labels, onSlow, watch, textures, rest, frame, reduced, bank}: RigProps) {
  const {camera: cam, size, scene} = useThree();
  const view = useRef<View | null>(null);
  const vel = useRef({...ZERO_VEL});
  const fog = useMemo(() => new THREE.FogExp2('#C49A82', 0), []);
  useEffect(() => {
    (window as unknown as {__board3dPoke?: unknown}).__board3dPoke = (ids: string[]) => {
      (window as unknown as {__board3dPoked?: unknown}).__board3dPoked = {ids, until: performance.now() + 2600};
    };
  }, []);
  useEffect(() => { scene.fog = fog; return () => { scene.fog = null; }; }, [scene, fog]);
  const frames = useRef<number[]>([]);
  const windowStart = useRef(performance.now());
  const mounted = useRef(performance.now());
  const verdict = useRef({bad: 0});
  const mode = camera?.mode ?? 'live';
  // each focus point carries the middle height of what stands there, so a dive centres the model, not its foot
  const focusOf = (ids: string[]) => ids.map((id) => {
    const c = geo.cells.find((x) => x.id === id) ?? geo.offMap.find((x) => x.id === id);
    if (!c) return null;
    const sp = spaces.get(id) ?? c.space;
    const kind = tileKind(sp.tileType);
    return {x: c.x, z: c.z, y: ('label' in c ? 0.32 : 0) + prismHeight(sp) + (kind ? MODEL_MID[kind] * PRISM_R : 0)};
  }).filter(Boolean) as Array<{x: number; z: number; y: number}>;
  const briefPts = focusOf(camera?.focus ?? []);
  const v3 = useMemo(() => new THREE.Vector3(), []);
  const freeSince = useRef(performance.now());
  const tagState = useRef({at: 0, hidden: new Map<string, boolean>(), vis: new Map<string, number>(), boxes: new Map<string, {boxes: THREE.Box3[]; at: number}>()});
  const flight = useRef<{seen: number; start: number | null; strength: 'step' | 'max'}>({seen: 0, start: null, strength: 'step'});
  const lod = useRef({changed: new Map<string, number>(), pos: new THREE.Vector3(), frustum: new THREE.Frustum(), m: new THREE.Matrix4(), sphere: new THREE.Sphere()});

  const lens = useRef({key: ''});
  // dives and passes are sized from the plate, not from how close the resting view stands
  const ref = refDist(geo.discR);

  // ---- Fly over Mars (experimental) ----
  const flyRef = useRef<{state: FlyState | null; land: {pos: THREE.Vector3; aim: THREE.Vector3; bank: number; t0: number} | null; tops: Map<string, number>; topsAt: number; floor: number}>(
    {state: null, land: null, tops: new Map(), topsAt: -1e9, floor: 0});
  const flyTmp = useMemo(() => ({dir: new THREE.Vector3(), boxes: [] as THREE.Box3[]}), []);
  /** What the camera keeps above: each hex and what stands on it, at the height of its tallest solid part (measured
   *  from the models every half second; a model not yet measured counts at the tallest any model may stand). */
  const obstacles = (now: number): Obstacle[] => {
    const f = flyRef.current;
    if (now - f.topsAt > 500) {
      f.topsAt = now;
      for (const [id, g] of MODEL_GROUPS) {
        let top = -Infinity;
        for (const b of solidBoxes(g, flyTmp.boxes)) top = Math.max(top, b.max.y);
        if (Number.isFinite(top)) f.tops.set(id, top); else f.tops.delete(id);
      }
    }
    const out: Obstacle[] = [];
    for (const c of [...geo.cells, ...geo.offMap]) {
      const sp = spaces.get(c.id) ?? c.space;
      const base = ('label' in c ? PAD_LIFT : 0) + prismHeight(sp);
      const model = tileKind(sp.tileType) ? (MODEL_GROUPS.has(c.id) ? f.tops.get(c.id) ?? base + MODEL_TALL * PRISM_R : base + MODEL_TALL * PRISM_R) : base;
      out.push({x: c.x, z: c.z, r: PRISM_R * 1.04, top: Math.max(base, model)});
    }
    return out;
  };
  const restY = cameraPosition(rest)[1];
  /** One frame of flight, or of the landing back to the resting view. */
  const flyFrame = (phase: 'off' | 'flying' | 'landing', dt: number) => {
    const f = flyRef.current, pc = cam as THREE.PerspectiveCamera, now = performance.now();
    const [rx0, , rz0] = cameraPosition(rest);
    const bounds: FlyBounds = {cx: rest.tx, cz: rest.tz, radius: geo.discR * 1.0, radiusTop: Math.max(geo.discR * 1.0, Math.hypot(rx0 - rest.tx, rz0 - rest.tz) * 1.1),
      ceiling: restY * 1.1, clearance: PRISM_R * 0.45, obstacles: obstacles(now)};
    if (phase === 'flying') {
      if (!f.state) { pc.getWorldDirection(flyTmp.dir); f.state = flyFrom([pc.position.x, pc.position.y, pc.position.z], [flyTmp.dir.x, flyTmp.dir.y, flyTmp.dir.z]); }
      f.land = null;
      // (test hook: window.__board3dFlyAt = {x, y, z, yaw, pitch} puts the flying camera there, for screenshots)
      const put = (window as unknown as {__board3dFlyAt?: Partial<FlyState> | null});
      if (put.__board3dFlyAt) { f.state = {...f.state, vx: 0, vy: 0, vz: 0, yawRate: 0, pitchRate: 0, ...put.__board3dFlyAt}; put.__board3dFlyAt = null; }
      const c = flyControls;
      const input = mixInputs(c.keys, c.pad, now - c.phoneAt < FLY_STALE_MS ? c.phone : null);
      const look = c.look; c.look = {yaw: 0, pitch: 0};
      f.state = stepFlight(f.state, input, look, dt, bounds, {reduced, bank, speed: c.speed});
      pc.position.set(f.state.x, f.state.y, f.state.z);
      pc.rotation.order = 'YXZ';
      pc.rotation.set(f.state.pitch, f.state.yaw, f.state.bank);
    } else {
      // landing: from wherever the flight left the camera to the resting view. The camera keeps looking at a point
      // on the board that slides to the resting view's, and the height leads, so it climbs before it travels.
      if (!f.land) {
        pc.getWorldDirection(flyTmp.dir);
        const hit = flyTmp.dir.y < -0.05 ? Math.min(pc.position.y / -flyTmp.dir.y, geo.discR * 1.5) : geo.discR * 0.8;
        const aim = pc.position.clone().addScaledVector(flyTmp.dir, hit);
        f.land = {pos: pc.position.clone(), aim: aim.setY(Math.max(0, aim.y)), bank: f.state?.bank ?? 0, t0: now};
      }
      const t = reduced ? 1 : (now - f.land.t0) / 1500;
      const e = landEase(t);
      const [rx, ry, rz] = cameraPosition(rest);
      pc.position.set(f.land.pos.x + (rx - f.land.pos.x) * e.xz, f.land.pos.y + (ry - f.land.pos.y) * e.y, f.land.pos.z + (rz - f.land.pos.z) * e.xz);
      pc.rotation.order = 'XYZ';
      pc.lookAt(f.land.aim.x + (rest.tx - f.land.aim.x) * e.turn, f.land.aim.y * (1 - e.turn), f.land.aim.z + (rest.tz - f.land.aim.z) * e.turn);
      if (f.land.bank) pc.rotateZ(f.land.bank * (1 - e.turn));
      if (t >= 1) {
        f.state = null; f.land = null;
        pc.rotation.order = 'XYZ';
        pc.position.set(rx, ry, rz); pc.lookAt(rest.tx, 0, rest.tz);
        if (pc.near !== 0.5) { pc.near = 0.5; pc.updateProjectionMatrix(); }
        landed();
      }
    }
    // a near plane close enough for the low passes, back to the usual one higher up
    const over = pc.position.y - floorAt(pc.position.x, pc.position.z, bounds);
    f.floor = over;
    const near = f.state || f.land ? nearFor(over, bounds.clearance) : 0.5;
    if (Math.abs(pc.near - near) > 0.002) { pc.near = near; pc.updateProjectionMatrix(); }
    // the air: as low as the camera is, so the mist lies between the tiles and what is far behind softens
    pc.getWorldDirection(flyTmp.dir);
    const zoomEq = Math.max(1, restY / Math.max(0.05, pc.position.y));
    world.topFade = Math.max(0, Math.min(1, (zoomEq - 1.15) / 0.5));
    fogState.amount = 0;
    fogState.dive = Math.max(0, Math.min(1, (zoomEq - 1.25) / 2.6));
    const hit = flyTmp.dir.y < -0.03 ? pc.position.y / -flyTmp.dir.y : rest.dist;
    fogState.focus = Math.max(0.6, Math.min(rest.dist, hit));
    fogState.enabled = (window as unknown as {__board3dFx?: boolean}).__board3dFx !== false;
    fogState.camY = pc.position.y;
    fogState.flying = true;
    fog.density = (fogState.dive * 0.2) / Math.max(1.2, fogState.focus);
    fogState.restY = ref * Math.cos(REST_POLAR);
    fogState.tint.copy(FOG_DAY).lerp(FOG_NIGHT, fogState.night * 0.85);
    fog.color.copy(fogState.tint);
  };

  useFrame((state, dt) => {
    applyLens(cam as THREE.PerspectiveCamera, size.width, size.height, frame, lens.current);
    // test hook: window.__board3dPoke(ids) looks at these spaces for 2.6 s, as a placement would
    const poke = (window as unknown as {__board3dPoked?: {ids: string[]; until: number}}).__board3dPoked;
    // a fresh placement keeps the camera while its model builds, after the brief has let go
    const held = cameraHold.until > performance.now() ? focusOf(cameraHold.ids) : [];
    const focusPts = poke && poke.until > performance.now() ? focusOf(poke.ids) : briefPts.length ? briefPts : held;
    // experimental: Fly over Mars takes the camera while flying, and eases it back to the resting view after
    const phase = useFly.getState().phase;
    let target: View = rest;
    if (phase !== 'off' || flyRef.current.state) {
      flyFrame(phase, dt);
      // moments that arrive while flying are not flown later: by then they are old news
      if (camera?.moment) flight.current = {seen: camera.moment.at, start: null, strength: flight.current.strength};
      freeSince.current = performance.now();
      view.current = rest; vel.current = {...ZERO_VEL};
    } else {
      target = focusView(focusPts, rest, {enabled: moves, mode, R: geo.discR});
      // a big moment flies over once the board is free; a placement in focus takes precedence
      const m = camera?.moment;
      const nowMs = Date.now();
      if (m && m.at !== flight.current.seen) {
        if (nowMs - m.at > MOMENT.maxDelayMs) flight.current.seen = m.at;
        // the moment's cinematic takes a beat to cover the board: wait for it, then fly once the board is free
        else if (moves && !focusPts.length && nowMs - m.at > MOMENT.settleMs && performance.now() - freeSince.current > MOMENT.settleMs) {
          flight.current = {seen: m.at, start: state.clock.elapsedTime, strength: m.strength};
        }
      }
      // (test hook: window.__board3dFly('max' | 'step') starts a big-moment pass now, as a real moment would)
      const fly = (window as unknown as {__board3dFly?: 'max' | 'step' | null});
      if (fly.__board3dFly && moves) { flight.current = {seen: flight.current.seen, start: state.clock.elapsedTime, strength: fly.__board3dFly}; fly.__board3dFly = null; }
      if (!moves) freeSince.current = performance.now();
      if (flight.current.start !== null && moves && !focusPts.length) {
        const mv = momentView(rest, state.clock.elapsedTime - flight.current.start, flight.current.strength, ref);
        if (mv) target = mv; else flight.current.start = null;
      } else if (flight.current.start !== null) {
        // cut short (a cinematic or a placement took over): fly again once the board is free
        flight.current = {seen: 0, start: null, strength: flight.current.strength};
      }
      if (!view.current) view.current = rest;
      if (moves || Math.abs(view.current.dist - rest.dist) > 1e-3 || Math.abs(view.current.polar - rest.polar) > 1e-4) {
        const r = stepView(view.current, vel.current, target, dt);
        view.current = r.view; vel.current = r.vel;
      } else { view.current = target; vel.current = {...ZERO_VEL}; }
      const v = view.current;
      cam.position.set(...cameraPosition(v));
      cam.lookAt(v.tx, 0, v.tz);
      // a placement lands with a small bounce of the camera
      if (moves) cam.position.y += kickOffset() * v.dist / 10;
      // fog: thickest while the camera travels, a light haze while it holds close, clear at rest
      const amt = moveAmount(v, rest, mode, ref);
      const speed = Math.min(1, Math.abs(vel.current.dist) / (rest.dist * 0.55));
      fogState.amount = Math.min(1, speed * 0.9 + amt * 0.18);
      // painted tops fade out as the camera dives past the default view: close-ups show models, not text
      world.topFade = Math.max(0, Math.min(1, (rest.dist / v.dist - 1.15) / 0.5));
      // How far down in the world the camera is (0 at rest, 1 at a placement close-up); while down, a distance
      // haze softens what lies far behind the tile (near tiles stay crisp), on top of the travel fog
      const zoom = rest.dist / v.dist;
      fogState.dive = Math.max(0, Math.min(1, (zoom - 1.25) / 2.6));
      fogState.focus = v.dist;
      // (test hook: window.__board3dFx = false turns the atmosphere off, for comparisons)
      fogState.enabled = (window as unknown as {__board3dFx?: boolean}).__board3dFx !== false;
      fogState.camY = cam.position.y;
      fogState.flying = false;
      fog.density = (fogState.amount * 0.45 + fogState.dive * 0.2) / v.dist;
      // the fog decks hang at fractions of the reference camera's height (where a plate-framing camera would stand), so a
      // dive passes through them however close the resting view stands
      fogState.restY = ref * Math.cos(REST_POLAR);
      fogState.tint.copy(FOG_DAY).lerp(FOG_NIGHT, fogState.night * 0.85);
      fog.color.copy(fogState.tint);
    }

    // Each tile's level of detail ('full' when focused or large on screen, 'lite' at the resting view)
    if (tileSet() !== 'classic') updateLod(focusPts.length ? (poke && poke.until > performance.now() ? poke.ids : camera?.focus?.length ? camera.focus : cameraHold.ids) : [], cam, geo, spaces, lod.current);

    // labels follow their anchors on screen
    const put = (id: string, x: number, y: number, z: number, below: number, centre = false) => {
      const el = labels.current.get(id);
      if (!el) return;
      v3.set(x, y, z).project(cam);
      if (v3.z > 1) { el.style.transform = 'translate(-9999px, 0)'; return; }
      const px = (v3.x + 1) / 2 * size.width, py = (1 - v3.y) / 2 * size.height;
      el.style.transform = `translate(${px.toFixed(1)}px, ${(py + below).toFixed(1)}px) translate(-50%, ${centre ? '-50%' : '0'})`;
    };
    for (const o of geo.offMap) put(`off-${o.id}`, o.x, 0.32, o.z + PRISM_R * 1.3, 4);
    const v = view.current!;
    // special names show only in a dive, small, under the tile's front edge (the model names it at the default view);
    // a name whose spot a model in front hides fades out (tagOccluded), so it never shows through a tower
    const nameOp = Math.max(0, world.topFade * 1.4 - 0.4);
    const tags = tagState.current;
    const check = nameOp > 0 && performance.now() - tags.at > 100;
    if (check) tags.at = performance.now();
    const kf = 1 - Math.exp(-dt * 9);
    for (const c of [...geo.cells, ...geo.offMap]) {
      const sp = spaces.get(c.id);
      if (!sp || tileKind(sp.tileType) !== 'special') continue;
      // in the hex's front band, at the height of its top
      const ax = c.x, ay = ('label' in c ? 0.32 : 0) + prismHeight(sp), az = c.z + PRISM_R * 0.92;
      put(`sp-${c.id}`, ax, ay, az, 6);
      if (check) tags.hidden.set(c.id, tagOccluded(cam, c.id, ax, ay, az, tags.boxes));
      const want = nameOp > 0 && !tags.hidden.get(c.id) ? 1 : 0;
      const vis = (tags.vis.get(c.id) ?? want) + (want - (tags.vis.get(c.id) ?? want)) * kf;
      tags.vis.set(c.id, vis);
      const op = (nameOp * vis).toFixed(3);
      const el = labels.current.get(`sp-${c.id}`);
      if (el && el.style.opacity !== op) el.style.opacity = op;
    }
    for (const hv of hovers) {
      const c = geo.cells.find((x) => x.id === hv.spaceId) ?? geo.offMap.find((x) => x.id === hv.spaceId);
      if (c) put(`ghost-${hv.playerId}`, c.x, ('label' in c ? 0.32 : 0) + prismHeight(spaces.get(c.id) ?? c.space), c.z + PRISM_R, 6);
    }

    // frame-time watch: a TV that cannot hold the budget falls back to the flat board
    const now = performance.now();
    // (test hook: window.__board3dFakeFrameMs stands in for the measured frame time, to force the fallback)
    const fake = (window as unknown as {__board3dFakeFrameMs?: number}).__board3dFakeFrameMs;
    if (document.visibilityState === 'visible' && watch) frames.current.push(typeof fake === 'number' ? fake : dt * 1000);
    if (now - windowStart.current >= FALLBACK.windowMs) {
      const r = fallbackStep(verdict.current, frames.current, now - mounted.current, document.hasFocus());
      verdict.current = {bad: r.bad};
      // (test hook: window.__board3dNoFallback keeps the 3D board for screenshot runs, which stall frames themselves)
      const w = window as unknown as {__board3dNoFallback?: boolean; __board3dSlowWindows?: number};
      if (r.bad) w.__board3dSlowWindows = (w.__board3dSlowWindows ?? 0) + 1;
      if (r.fallback && r.stats && !w.__board3dNoFallback) onSlow(r.stats);
      frames.current = [];
      windowStart.current = now;
    }
    // test hook (like window.__cam): the 3D camera's state and a projector for overlays and checks
    (window as unknown as {__board3d?: unknown}).__board3d = {view: v, target, rest, moves, mode, fog: fogState.amount, dive: fogState.dive, textures, flying: flight.current.start !== null,
      // experimental: Fly over Mars (the phase, the flight, the room under the camera and the near plane)
      fly: {phase, state: flyRef.current.state, over: flyRef.current.floor, near: (cam as THREE.PerspectiveCamera).near, cam: cam.position.toArray()},
      // special names hidden because a model stands in front of them
      tagsHidden: [...tagState.current.hidden].filter(([, h]) => h).map(([id]) => id),
      // how much of each empty space's top the models in front of it hide from the camera (7 sample points: centre,
      // and six at half radius), for the legibility check
      occlusion: () => {
        const ray = new THREE.Raycaster(), out: Record<string, number> = {};
        const solid = (o: THREE.Object3D) => {
          const m = (o as THREE.Mesh).material as THREE.Material | undefined;
          return (o as THREE.Mesh).isMesh && !!m && !Array.isArray(m) && m.visible && m.depthWrite && !(m.transparent && m.opacity < 0.5);
        };
        const meshes: THREE.Object3D[] = [];
        state.scene.traverseVisible((o) => { if (solid(o)) meshes.push(o); });
        for (const c of geo.cells) {
          const sp = spaces.get(c.id) ?? c.space;
          if (sp.tileType !== undefined) continue;
          const y = prismHeight(sp) + 0.001;
          let hidden = 0;
          for (let k = 0; k < 7; k++) {
            const a = (k / 6) * Math.PI * 2, r = k ? PRISM_R * 0.5 : 0;
            const p = new THREE.Vector3(c.x + Math.cos(a) * r, y, c.z + Math.sin(a) * r);
            const d = cam.position.distanceTo(p);
            ray.set(cam.position, p.clone().sub(cam.position).normalize());
            ray.far = d - 0.01;
            if (ray.intersectObjects(meshes, false).some((h) => h.distance < d - 0.01)) hidden++;
          }
          out[c.id] = hidden / 7;
        }
        return out;
      },
      // each special name: hidden by the box test, and how many of its three spots the models' actual meshes hide
      tagCheck: () => {
        const ray = new THREE.Raycaster(), out: Record<string, {hidden: boolean; meshBlocked: number; onScreen: boolean}> = {};
        const meshes: THREE.Object3D[] = [];
        for (const [, g] of MODEL_GROUPS) g.traverseVisible((o) => {
          const m = (o as THREE.Mesh).material as THREE.Material | undefined;
          if ((o as THREE.Mesh).isMesh && !(o as unknown as THREE.Sprite).isSprite && m && !Array.isArray(m) && m.depthWrite) meshes.push(o);
        });
        const side = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0).setY(0).normalize().multiplyScalar(PRISM_R * 0.5);
        for (const c of [...geo.cells, ...geo.offMap]) {
          const sp = spaces.get(c.id);
          if (!sp || tileKind(sp.tileType) !== 'special') continue;
          const own = MODEL_GROUPS.get(c.id);
          const p0 = new THREE.Vector3(c.x, ('label' in c ? 0.32 : 0) + prismHeight(sp) + 0.02, c.z + PRISM_R * 0.92);
          let blocked = 0;
          for (const k of [0, -1, 1]) {
            const p = p0.clone().addScaledVector(side, k), d = cam.position.distanceTo(p);
            ray.set(cam.position, p.clone().sub(cam.position).normalize()); ray.far = d - 0.02;
            const hits = ray.intersectObjects(meshes, false).filter((h) => { let o: THREE.Object3D | null = h.object; while (o && o !== own) o = o.parent; return !o; });
            if (hits.length) blocked++;
          }
          const q = p0.clone().project(cam);
          out[c.id] = {hidden: !!tagState.current.hidden.get(c.id), meshBlocked: blocked, onScreen: Math.abs(q.x) < 1 && Math.abs(q.y) < 1 && q.z < 1};
        }
        return out;
      },
      // What each tile's model draws now: meshes (≈ draw calls; each visible mesh is one, more with shadows or the
      // depth-of-field pass) and triangles, with its set and detail level; plus the renderer's last frame totals
      modelStats: () => {
        const out: Record<string, {model: string; set: string; detail: string; calls: number; tris: number}> = {};
        for (const [id, g] of MODEL_GROUPS) {
          let calls = 0, tris = 0, model = 'built-in', set = 'built-in', detail = '';
          g.traverseVisible((o) => {
            const ud = o.userData as {model?: string; set?: string; detail?: string};
            if (ud.model) { model = ud.model; set = ud.set ?? '?'; detail = ud.detail ?? ''; }
            const m = o as THREE.Mesh;
            if (!(m.isMesh || (o as THREE.Points).isPoints || (o as THREE.Line).isLine || (o as unknown as THREE.Sprite).isSprite)) return;
            calls++;
            if (!m.isMesh || !m.geometry) return;
            const geom = m.geometry as THREE.BufferGeometry;
            const n = geom.index ? geom.index.count : geom.attributes.position?.count ?? 0;
            const inst = (m as THREE.InstancedMesh).isInstancedMesh ? (m as THREE.InstancedMesh).count : 1;
            const range = Number.isFinite(geom.drawRange.count) ? Math.min(n, geom.drawRange.count) : n;
            tris += Math.round(range / 3) * inst;
          });
          out[id] = {model, set, detail, calls, tris};
        }
        return {tiles: out, render: {...state.gl.info.render}};
      },
      project: (id: string) => {
        const c = geo.cells.find((x) => x.id === id);
        if (!c) return null;
        const p = new THREE.Vector3(c.x, prismHeight(spaces.get(id) ?? c.space), c.z).project(cam);
        const rect = state.gl.domElement.getBoundingClientRect();
        return {x: rect.left + (p.x + 1) / 2 * rect.width, y: rect.top + (1 - p.y) / 2 * rect.height};
      }};
  });
  return null;
}

// ---- the move pipeline's reticle --------------------------------------------------------------------------------
const RETICLE_RING = (() => { const g = new THREE.RingGeometry(PRISM_R * 1.1, PRISM_R * 1.22, 6, 1); g.rotateX(-Math.PI / 2); return g; })();
/** Four short ticks pointing in at the hex, like a sight's crosshair. */
const RETICLE_TICKS = (() => {
  const pts: number[] = [];
  for (let i = 0; i < 4; i++) {
    const a = (Math.PI / 2) * i;
    const r0 = PRISM_R * 1.35, r1 = PRISM_R * 1.75;
    pts.push(Math.cos(a) * r0, 0, Math.sin(a) * r0, Math.cos(a) * r1, 0, Math.sin(a) * r1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return g;
})();

/**
 * Pings a hex before its tile drops (pipeline/store.ts pingHex): each ping closes in from wide to the hex's edge and
 * fades; the ticks hold still between pings. Always drawn (fully transparent at rest: a dozen triangles), so its
 * shaders are compiled with the board's and a ping never stalls a frame; it draws over the models (no depth test) so
 * neighbours never hide it.
 */
function Reticle({geo, byId}: {geo: Board3; byId: Map<string, SpaceModel>}) {
  const reticle = usePipeline((s) => s.reticle);
  const group = useRef<THREE.Group>(null);
  const ring = useRef<THREE.MeshBasicMaterial>(null);
  const ticks = useRef<THREE.LineBasicMaterial>(null);
  const spot = useMemo(() => {
    if (!reticle) return null;
    const c = geo.cells.find((x) => x.id === reticle.spaceId) ?? geo.offMap.find((x) => x.id === reticle.spaceId);
    if (!c) return null;
    return {x: c.x, z: c.z, y: ('label' in c ? 0.32 : 0) + prismHeight(byId.get(c.id) ?? c.space) + 0.015};
  }, [reticle, geo, byId]);
  useEffect(() => {
    const c = new THREE.Color(reticle ? PLAYER_HEX[reticle.color as Color] ?? '#fff' : '#fff');
    ring.current?.color.copy(c).lerp(new THREE.Color('#ffffff'), 0.25);
    ticks.current?.color.copy(c).lerp(new THREE.Color('#ffffff'), 0.45);
  }, [reticle]);
  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const t = reticle && spot ? performance.now() - reticle.at : Infinity;
    const total = reticle ? reticle.pings * reticle.ping + 220 : 0;
    if (!reticle || !spot || t > total) {
      if (ring.current && ring.current.opacity !== 0) { ring.current.opacity = 0; if (ticks.current) ticks.current.opacity = 0; invalidate(); }
      return;
    }
    g.position.set(spot.x, spot.y, spot.z);
    const k = Math.min(reticle.pings - 1, Math.floor(t / reticle.ping));
    const u = Math.min(1, (t - k * reticle.ping) / reticle.ping);
    const close = 1 - Math.pow(1 - Math.min(1, u / 0.55), 3);
    const tail = t > reticle.pings * reticle.ping ? 1 - (t - reticle.pings * reticle.ping) / 220 : 1;
    g.scale.setScalar(1 + 0.9 * (1 - close));
    if (ring.current) ring.current.opacity = Math.max(0, tail) * (u < 0.55 ? 0.35 + 0.65 * close : 1 - 0.55 * (u - 0.55) / 0.45);
    if (ticks.current) ticks.current.opacity = Math.max(0, tail) * 0.9;
    invalidate();
  });
  return (
    <group ref={group} renderOrder={20}>
      <mesh geometry={RETICLE_RING} renderOrder={20}>
        <meshBasicMaterial ref={ring} color="#ffffff" transparent opacity={0} depthWrite={false} depthTest={false} fog={false} side={THREE.DoubleSide} />
      </mesh>
      <lineSegments geometry={RETICLE_TICKS} renderOrder={20}>
        <lineBasicMaterial ref={ticks} color="#ffffff" transparent opacity={0} depthTest={false} fog={false} />
      </lineSegments>
    </group>
  );
}
