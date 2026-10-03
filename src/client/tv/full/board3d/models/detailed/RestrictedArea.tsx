// Restricted Area, Detailed set (engine tile 13): a secret research base. A double chain-link fence with lit owner-colour
// posts, four guard towers (two with searchlights sweeping the yard), a hangar with an experimental flying wing nosing
// out of its doors, a lab block under a turning radar dish, antenna masts with blinking lights, a helipad where a
// helicopter lands and lifts off on a loop, parked vehicles, tiny people, floodlights and owner-colour accents.
// Draw calls (full and lite): ground, fence, compound, helicopter, searchlights + ground light, glow points = 6.
// Build-in (~2.8 s): the fence ripples up round the perimeter, buildings drop in, the radar spins up, the lights switch on.
import {useFrame} from '@react-three/fiber';
import {useEffect, useMemo, useRef} from 'react';
import * as THREE from 'three';
import {PLAYER_HEX} from '../../../../../../shared/game';
import {seeded, world} from '../../tiles3d';
import type {ModelMeta, ModelProps} from '../contract';
import {detailMaterial, ease, glowMaterial} from './NuclearKit';
import {HELI_C, PAD, lightMaterial, restrictedAssets, restrictedGlow} from './RestrictedDetail';

export const meta: ModelMeta = {set: 'detailed', name: 'Restricted Area (detailed)', tileTypes: [13], kind: 'special', buildSeconds: 2.8};

const CYCLE = 44;
const TH0 = Math.atan2(PAD.z - HELI_C.z, PAD.x - HELI_C.x);
const sm = (x: number) => { const k = Math.min(1, Math.max(0, x)); return k * k * (3 - 2 * k); };

export default function RestrictedArea(p: ModelProps) {
  const lite = p.detail === 'lite';
  const A = restrictedAssets();
  const owner = PLAYER_HEX[p.color ?? 'red'] ?? '#ff4a3a';
  const rot = useMemo(() => Math.floor(seeded(p.id, 5)() * 6) * (Math.PI / 3), [p.id]);
  const off = useMemo(() => seeded(p.id, 6)() * CYCLE, [p.id]);
  const structGeo = useMemo(() => A.structures(owner, lite), [A, owner, lite]);
  const heliGeo = useMemo(() => A.heli(owner, lite), [A, owner, lite]);
  const lightGeo = useMemo(() => A.lights(owner, lite), [A, owner, lite]);
  const glowGeo = useMemo(() => restrictedGlow(owner, seeded(p.id, 9), lite), [p.id, owner, lite]);
  const dm = useMemo(() => detailMaterial({roughness: 0.62, metalness: 0.2, side: THREE.DoubleSide}), []);
  const hm = useMemo(() => detailMaterial({roughness: 0.55, metalness: 0.25}), []);
  const fence = useMemo(() => A.makeFenceMat(), [A]);
  const lightMat = useMemo(() => lightMaterial(), []);
  const glowMat = useMemo(() => glowMaterial(), []);
  useEffect(() => () => { glowGeo.dispose(); dm.mat.dispose(); dm.depth.dispose(); hm.mat.dispose(); hm.depth.dispose(); fence.mat.dispose(); lightMat.dispose(); glowMat.dispose(); }, [glowGeo, dm, hm, fence, lightMat, glowMat]);

  const heli = useRef<THREE.Mesh>(null);
  const nightRef = useRef(p.night); nightRef.current = p.night;
  const rotor = useRef({ang: 0, speed: 0});

  useFrame((state, dt) => {
    const t = world.t, a = world.reduced ? 999 : p.age(), night = nightRef.current;
    const spin = world.reduced ? 0 : t;
    for (const m of [dm]) { m.u.uAge.value = a; m.u.uSpin.value = spin; m.u.uGl.value = 0.15 + 1.35 * night; }
    fence.uAge.value = a;
    lightMat.uniforms.uNight.value = night; lightMat.uniforms.uTime.value = t; lightMat.uniforms.uMotion.value = world.reduced ? 0 : 1;
    lightMat.uniforms.uOn.value = ease.clamp((a - 1.4) / 0.6) * (a < 2.0 ? 0.6 + 0.4 * Math.sin(a * 60) : 1);
    const u = glowMat.uniforms; u.uTime.value = t; u.uAge.value = a; u.uNight.value = night; u.uH.value = state.size.height * state.viewport.dpr;
    // the helicopter: parked, spools up, lifts, circles the compound once, lands, spools down
    const h = heli.current; if (!h) return;
    h.visible = a > 1.6;
    hm.u.uGl.value = 0.15 + 1.35 * night; hm.u.uAge.value = 999;
    let px = PAD.x, pz = PAD.z, py = 0.0, th = TH0, spd = 0;
    if (!world.reduced) {
      const c = (t + off) % CYCLE;
      if (c < 10) { spd = 0; }
      else if (c < 13) { spd = sm((c - 10) / 3); }
      else if (c < 17) { spd = 1; py = 0.56 * sm((c - 13) / 4); }
      else if (c < 33) { spd = 1; py = 0.56 + 0.02 * Math.sin(c); th = TH0 + ((c - 17) / 16) * Math.PI * 2; }
      else if (c < 38) { spd = 1; py = 0.56 * (1 - sm((c - 33) / 5)); th = TH0 + Math.PI * 2; }
      else if (c < 41) { spd = 1 - sm((c - 38) / 3); }
      if (py > 0.001 && c >= 17 && c < 33) { px = HELI_C.x + Math.cos(th) * HELI_C.r; pz = HELI_C.z + Math.sin(th) * HELI_C.r; }
      const moving = c >= 17 && c < 33;
      const yawTh = moving ? th : TH0 + (c >= 33 ? Math.PI * 2 : 0);
      h.rotation.y = Math.atan2(-Math.sin(yawTh), Math.cos(yawTh));
      h.rotation.z = moving ? -0.12 : 0; // bank into the turn
      rotor.current.speed = spd;
      rotor.current.ang += dt * spd * 24;
    } else { h.rotation.y = Math.atan2(-Math.sin(TH0), Math.cos(TH0)); h.rotation.z = 0; }
    hm.u.uSpin.value = rotor.current.ang;
    h.position.set(px, py + 0.003, pz);
  });

  return (
    <group position={[0, p.top, 0]} rotation={[0, rot, 0]} scale={p.radius}>
      <mesh geometry={A.ground} material={A.groundMat} receiveShadow />
      <mesh geometry={lite ? A.fences.lite : A.fences.full} material={fence.mat} frustumCulled={false} />
      <mesh geometry={structGeo} material={dm.mat} customDepthMaterial={dm.depth} castShadow receiveShadow frustumCulled={false} />
      <mesh ref={heli} geometry={heliGeo} material={hm.mat} frustumCulled={false} castShadow />
      <mesh geometry={lightGeo} material={lightMat} renderOrder={5} frustumCulled={false} />
      <points geometry={glowGeo} material={glowMat} frustumCulled={false} renderOrder={8} />
    </group>
  );
}
