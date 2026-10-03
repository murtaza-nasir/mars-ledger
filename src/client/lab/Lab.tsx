// Model lab (dev only: open /lab.html on the Vite dev server). Shows one 3D tile model from
// src/client/tv/full/board3d/models/ on a patch of hexes, by day or night, with its placement replayed on demand.
// URL parameters drive it for screenshots: ?model=<file name>&night=0..1&cam=default|close|top&color=red&replay=1
// &stress=40 (that many instances in a grid, for frame timing) &reduced=1. window.__lab reports readiness and frames.
import {Canvas, useFrame, useThree} from '@react-three/fiber';
import {StrictMode, useEffect, useMemo, useRef, useState, type ComponentType} from 'react';
import {createRoot} from 'react-dom/client';
import * as THREE from 'three';
import {PLAYER_HEX} from '../../shared/game';
import type {Color} from '../../shared/full';
import {HEIGHT, PRISM_R, TILE_HEIGHT} from '../tv/full/board3d/geometry3d';
import {world} from '../tv/full/board3d/tiles3d';
import type {ModelMeta, ModelProps} from '../tv/full/board3d/models/contract';

type Mod = {default: ComponentType<ModelProps>; meta: ModelMeta};
// classic models sit in models/, other tile sets in models/<set>/ (e.g. ?model=detailed/City)
const mods = import.meta.glob<Mod>('../tv/full/board3d/models/**/*.tsx', {eager: true});
const MODELS = Object.entries(mods).filter(([, m]) => m.default && m.meta)
  .map(([path, m]) => ({file: path.replace('../tv/full/board3d/models/', '').replace('.tsx', ''), ...m}));

const q = new URLSearchParams(location.search);
const lab = {ready: false, frames: [] as number[]};
(window as unknown as {__lab: typeof lab}).__lab = lab;

// pointy-top hex positions: the centre and its six neighbours
const SQ3 = Math.sqrt(3);
const D = PRISM_R * SQ3 * 1.06;
const RING: Array<[number, number]> = [[0, 0], [D, 0], [-D, 0], [D / 2, D * SQ3 / 2], [-D / 2, D * SQ3 / 2], [D / 2, -D * SQ3 / 2], [-D / 2, -D * SQ3 / 2]];

function Prism({x, z, h, color}: {x: number; z: number; h: number; color: string}) {
  const geo = useMemo(() => new THREE.CylinderGeometry(PRISM_R, PRISM_R * 1.02, h, 6, 1), [h]);
  return <mesh geometry={geo} position={[x, h / 2, z]}><meshStandardMaterial color={color} roughness={0.85} /></mesh>;
}

function Ticker({night, reduced}: {night: number; reduced: boolean}) {
  const last = useRef(performance.now());
  useFrame((_, dt) => {
    world.t += dt; world.night = night; world.reduced = reduced;
    const t = performance.now(); lab.frames.push(t - last.current); last.current = t;
    if (lab.frames.length > 2000) lab.frames.splice(0, 1000);
    lab.ready = true;
  });
  return null;
}

function Cam({mode}: {mode: string}) {
  const {camera} = useThree();
  useEffect(() => {
    const r = PRISM_R;
    if (mode === 'close') camera.position.set(r * 1.6, r * 2.4, r * 3.4);
    else if (mode === 'top') camera.position.set(0, r * 9, 0.001);
    else camera.position.set(r * 3.2, r * 5.5, r * 7.5);
    camera.lookAt(0, HEIGHT.land + r * 0.5, 0);
  }, [camera, mode]);
  return null;
}

function Scene({mod, night, color, cam, reduced, stress, born}: {mod: (typeof MODELS)[number]; night: number; color: Color; cam: string; reduced: boolean; stress: number; born: number}) {
  const M = mod.default;
  const kind = mod.meta.kind;
  const top = HEIGHT.land + TILE_HEIGHT[kind];
  const sun = 1 - night * 0.85;
  const spots: Array<[number, number, string]> = stress > 0
    ? Array.from({length: stress}, (_, i) => [((i % 8) - 3.5) * D, (Math.floor(i / 8) - 2.5) * D * 0.9, `s${i}`])
    : [[0, 0, 'lab-0']];
  return (
    <>
      <color attach="background" args={[new THREE.Color('#24130f').lerp(new THREE.Color('#070912'), night)]} />
      <fog attach="fog" args={[new THREE.Color('#3a1c14').lerp(new THREE.Color('#0a0c18'), night), PRISM_R * 8, PRISM_R * 30]} />
      <ambientLight intensity={0.35 * sun + 0.06} color={night > 0.5 ? '#6a7aa8' : '#ffd9c2'} />
      <directionalLight position={[3, 5, 2]} intensity={1.6 * sun} color="#ffd2a8" />
      <hemisphereLight args={['#f0b48a', '#2a1410', 0.4 * sun]} />
      <Cam mode={cam} />
      <Ticker night={night} reduced={reduced} />
      {stress === 0 && RING.slice(1).map(([x, z], i) => <Prism key={i} x={x} z={z} h={HEIGHT.land} color="#7a3a26" />)}
      {spots.map(([x, z, id]) => (
        <group key={id + born} position={[x, 0, z]}>
          <Prism x={0} z={0} h={top} color={kind === 'ocean' ? '#1e4a6e' : '#8a4630'} />
          <M id={id} detail={q.get('detail') === 'lite' ? 'lite' : 'full'} tileType={mod.meta.tileTypes[0]} color={color} fresh={born > 0} radius={PRISM_R} top={top} night={night}
            age={() => (born > 0 ? (performance.now() - born) / 1000 : 999)} />
        </group>
      ))}
    </>
  );
}

function Lab() {
  const [file, setFile] = useState(q.get('model') ?? MODELS[0]?.file ?? '');
  const [night, setNight] = useState(Number(q.get('night') ?? 0));
  const [cam, setCam] = useState(q.get('cam') ?? 'default');
  const [color, setColor] = useState<Color>((q.get('color') as Color) ?? 'red');
  const [born, setBorn] = useState(q.get('replay') ? performance.now() : 0);
  const reduced = q.get('reduced') === '1';
  const stress = Number(q.get('stress') ?? 0);
  const mod = MODELS.find((m) => m.file === file);
  (window as unknown as {__labReplay: () => void}).__labReplay = () => setBorn(performance.now());
  return (
    <div style={{position: 'fixed', inset: 0, fontFamily: 'system-ui', color: '#eaf2f4'}}>
      <Canvas dpr={[1, 2]} camera={{fov: 40, near: 0.001, far: 50}} gl={{antialias: true}}>
        {mod && <Scene mod={mod} night={night} color={color} cam={cam} reduced={reduced} stress={stress} born={born} />}
      </Canvas>
      <div data-testid="lab-panel" style={{position: 'absolute', top: 10, left: 10, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center',
        background: 'rgba(0,0,0,.5)', padding: 8, borderRadius: 8, fontSize: 13, opacity: q.get('clean') ? 0 : 1}}>
        <select value={file} onChange={(e) => { setFile(e.target.value); setBorn(0); }}>{MODELS.map((m) => <option key={m.file} value={m.file}>{m.meta.name}</option>)}</select>
        <label>night <input type="range" min={0} max={1} step={0.05} value={night} onChange={(e) => setNight(Number(e.target.value))} /></label>
        <select value={cam} onChange={(e) => setCam(e.target.value)}>{['default', 'close', 'top'].map((c) => <option key={c}>{c}</option>)}</select>
        <select value={color} onChange={(e) => setColor(e.target.value as Color)}>{Object.keys(PLAYER_HEX).map((c) => <option key={c}>{c}</option>)}</select>
        <button onClick={() => setBorn(performance.now())}>Place</button>
        {!MODELS.length && <span>No models yet in board3d/models/</span>}
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><Lab /></StrictMode>);
