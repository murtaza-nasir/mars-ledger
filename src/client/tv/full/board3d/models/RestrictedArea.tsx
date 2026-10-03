// Restricted Area (engine tile 13): a fenced research compound with glowing post tips chasing round the perimeter, a
// vaulted hangar, a spinning radar dish, guard towers and a searchlight sweeping the yard, with owner-colour accents.
// Draw calls: ground, compound (fence + buildings), radar dish, searchlight, ground light pools, glow points = 6.
// Build-in (~2.2 s): fence posts shoot up round the perimeter in a ripple, buildings drop in, the radar spins up and
// the searchlight switches on.
import {useFrame} from '@react-three/fiber';
import {useEffect, useMemo, useRef} from 'react';
import * as THREE from 'three';
import {PLAYER_HEX} from '../../../../../shared/game';
import {seeded, world} from '../tiles3d';
import type {ModelMeta, ModelProps} from './contract';
import {ease, glowMaterial, riseMaterial} from './NuclearGeo';
import {BEAM_AIM, RADAR_AT, RADAR_Y, restrictedAssets, restrictedOwner, TOWER_AT, TOWER_H} from './RestrictedBuild';

export const meta: ModelMeta = {name: 'Restricted Area', tileTypes: [13], kind: 'special', buildSeconds: 2.2};

export default function RestrictedArea(p: ModelProps) {
  const A = restrictedAssets();
  const owner = PLAYER_HEX[p.color ?? 'red'] ?? '#ff4a3a';
  const O = useMemo(() => restrictedOwner(owner), [owner]);
  const rot = useMemo(() => Math.floor(seeded(p.id, 5)() * 6) * (Math.PI / 3), [p.id]);
  const phase = useMemo(() => seeded(p.id, 6)() * 6.28, [p.id]);
  const rise = useMemo(() => riseMaterial({roughness: 0.7, metalness: 0.15}), []);
  const glowMat = useMemo(() => glowMaterial(), []);
  useEffect(() => () => { rise.mat.dispose(); glowMat.dispose(); }, [rise, glowMat]);

  const pool = useRef<THREE.Mesh>(null), dish = useRef<THREE.Mesh>(null), beam = useRef<THREE.Mesh>(null);
  const nightRef = useRef(p.night); nightRef.current = p.night;

  useFrame((state) => {
    const t = world.t, a = world.reduced ? 999 : p.age(), night = nightRef.current;
    rise.uAge.value = a;
    A.beamMat.uniforms.uNight.value = night; A.poolMat.uniforms.uNight.value = night;
    const u = glowMat.uniforms; u.uTime.value = t; u.uAge.value = a; u.uNight.value = night; u.uH.value = state.size.height * state.viewport.dpr;
    const d = dish.current, b = beam.current, pl = pool.current;
    if (pl) pl.visible = a > 1.0;
    if (d) {
      const k = ease.back((a - 1.25) / 0.5);
      d.visible = k > 0.001; d.scale.setScalar(Math.max(k, 0.001) * 1.0);
      d.rotation.y = world.reduced ? phase : t * (a < 2.6 ? 0.9 + 3.5 * Math.max(0, 1 - (a - 1.25) / 1.3) : 0.9) + phase;
    }
    if (b) {
      const on = ease.clamp((a - 1.6) / 0.45), flick = a < 2.1 ? 0.6 + 0.4 * Math.sin(a * 60) : 1;
      b.visible = on > 0.001; b.scale.set(on, on, on * flick);
      b.rotation.y = BEAM_AIM + (world.reduced ? 0 : Math.sin(t * 0.55 + phase) * 0.8);
    }
  });

  return (
    <group position={[0, p.top, 0]} rotation={[0, rot, 0]} scale={p.radius}>
      <mesh geometry={A.ground} material={A.groundMat} receiveShadow />
      <mesh geometry={O.structures} material={rise.mat} castShadow receiveShadow />
      <group position={[RADAR_AT[0], RADAR_Y, RADAR_AT[1]]}><mesh ref={dish} geometry={A.dish} material={A.dishMat} castShadow /></group>
      <group position={[TOWER_AT[0], TOWER_H + 0.05, TOWER_AT[1]]}><mesh ref={beam} geometry={A.beam} material={A.beamMat} renderOrder={5} /></group>
      <mesh ref={pool} geometry={O.pools} material={A.poolMat} renderOrder={4} />
      <points geometry={O.glow} material={glowMat} frustumCulled={false} renderOrder={8} />
    </group>
  );
}
