// Board life lab (dev only: open /life-lab.html on the Vite dev server). Shows the miniature terraformers in any pose on a
// hex of Mars. URL parameters drive it for screenshots: ?pose=walk&pose2=wave&cam=close|default|front&night=0..1&expr=happy
// &reduced=1. window.__lifeLab reports readiness and triangle counts.
import {Canvas, useFrame, useThree} from '@react-three/fiber';
import {StrictMode, useEffect, useMemo} from 'react';
import {createRoot} from 'react-dom/client';
import * as THREE from 'three';
import {PRISM_R} from '../tv/full/board3d/geometry3d';
import {applyPose, makePose} from '../tv/full/board3d/life/anim';
import type {PoseId} from '../tv/full/board3d/life/anim';
import {createCharacter, setFace} from '../tv/full/board3d/life/rig';
import {glow} from '../tv/full/board3d/life/kit';
import {GENERIC_SKINS} from '../tv/full/board3d/life/skins';
import type {FaceKey} from '../tv/full/board3d/life/skins';

const q = new URLSearchParams(location.search);
const night = Number(q.get('night') ?? 0);
const lab = {ready: false, tris: [] as number[], frames: 0};
(window as unknown as {__lifeLab: typeof lab}).__lifeLab = lab;
const BIG = q.get('big') ? 3 : 1;
const H = 0.42 * PRISM_R * BIG;

function Chars() {
  const poses = [(q.get('pose') ?? 'walk') as PoseId, (q.get('pose2') ?? q.get('pose') ?? 'wave') as PoseId];
  const chars = useMemo(() => GENERIC_SKINS.map((s) => createCharacter(s)), []);
  const ps = useMemo(() => chars.map((_, i) => { const p = makePose(); p.pose = poses[i]; p.a = Number(q.get('a') ?? 0.5); return p; }), [chars]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    lab.tris = chars.map((c) => (c.mesh.geometry.index!.count) / 3);
    chars.forEach((c, i) => { c.group.scale.setScalar(H); c.group.position.set((i ? 1 : -1) * H * 0.7, 0.07, 0); c.group.rotation.y = q.get('front') ? 0 : (i ? -0.5 : 0.5); setFace(c, (q.get(i ? 'expr2' : 'expr') ?? 'neutral') as FaceKey); });
  }, [chars]);
  useFrame((_, dt) => {
    glow.value = night;
    chars.forEach((c, i) => { ps[i].ph += dt * 7; applyPose(c, ps[i], Math.min(dt, 0.05)); });
    lab.ready = true; lab.frames++;
  });
  return <>{chars.map((c, i) => <primitive key={i} object={c.group} />)}</>;
}

function Cam() {
  const {camera} = useThree();
  const mode = q.get('cam') ?? 'close';
  useEffect(() => {
    if (mode === 'default') camera.position.set(0, H * 9, H * 8);
    else if (mode === 'front') camera.position.set(0, 0.07 + H * 0.6, H * 3.2);
    else camera.position.set(H * 0.8, 0.07 + H * 1.1, H * 3.6);
    camera.lookAt(0, 0.07 + H * 0.5, 0);
  }, [camera, mode]);
  return null;
}

createRoot(document.getElementById('root')!).render(<StrictMode>
  <Canvas dpr={[1, 2]} camera={{fov: 30, near: 0.01, far: 50}} gl={{antialias: true}} shadows>
    <color attach="background" args={[new THREE.Color('#2a150f').lerp(new THREE.Color('#070912'), night)]} />
    <ambientLight intensity={0.5 * (1 - night * 0.8) + 0.08} color="#ffd9c2" />
    <directionalLight position={[3, 5, 2]} intensity={1.8 * (1 - night * 0.85)} color="#ffd2a8" />
    <hemisphereLight args={['#f0b48a', '#2a1410', 0.5 * (1 - night * 0.8)]} />
    <Cam />
    <mesh position={[0, 0.035, 0]}><cylinderGeometry args={[PRISM_R, PRISM_R * 1.02, 0.07, 6]} /><meshStandardMaterial color="#7a3a26" roughness={0.9} /></mesh>
    <Chars />
  </Canvas>
</StrictMode>);
