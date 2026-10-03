// Nuclear Zone (engine tile 12): a blast-scarred crater field with a glowing containment dome, cooling towers venting
// vapour, scorched glassy ground with glowing cracks and owner-colour hazard beacons.
// Draw calls: ground, structures, dome, core, fx (build-in only), glow points = 6 (5 once built).
// Build-in (~2.2 s): a white flash and blast ring, towers rise, dome lifts out of the ground, core ignites with a pulse ring.
import {useFrame} from '@react-three/fiber';
import {useEffect, useMemo, useRef} from 'react';
import * as THREE from 'three';
import {PLAYER_HEX} from '../../../../../shared/game';
import {seeded, world} from '../tiles3d';
import type {ModelMeta, ModelProps} from './contract';
import {nuclearAssets, nuclearGlow} from './NuclearBuild';
import {ease, glowMaterial, riseMaterial} from './NuclearGeo';

export const meta: ModelMeta = {name: 'Nuclear Zone', tileTypes: [12], kind: 'special', buildSeconds: 2.2};

const BUILD = 2.3;

export default function NuclearZone(p: ModelProps) {
  const A = nuclearAssets();
  const owner = PLAYER_HEX[p.color ?? 'red'] ?? '#ff4a3a';
  const rot = useMemo(() => Math.floor(seeded(p.id, 4)() * 6) * (Math.PI / 3), [p.id]);
  const glowGeo = useMemo(() => nuclearGlow(owner, seeded(p.id, 9)), [p.id, owner]);
  const rise = useMemo(() => riseMaterial({roughness: 0.75, metalness: 0.08}), []);
  const glowMat = useMemo(() => glowMaterial(), []);
  const fxMat = useMemo(() => A.fxMat.clone(), [A]);
  useEffect(() => () => { glowGeo.dispose(); rise.mat.dispose(); glowMat.dispose(); fxMat.dispose(); }, [glowGeo, rise, glowMat, fxMat]);

  const dome = useRef<THREE.Mesh>(null), core = useRef<THREE.Mesh>(null), fx = useRef<THREE.Mesh>(null);
  const structs = useRef<THREE.Mesh>(null), glow = useRef<THREE.Points>(null);
  const nightRef = useRef(p.night); nightRef.current = p.night;

  useFrame((state) => {
    const t = world.t, a = world.reduced ? 999 : p.age();
    const night = nightRef.current, pulse = 0.5 + 0.5 * Math.sin(t * 1.15);
    const building = a < BUILD;
    // shared materials: every instance writes the same value
    A.domeMat.uniforms.uTime.value = t; A.domeMat.uniforms.uNight.value = night;
    A.coreMat.uniforms.uTime.value = t; A.coreMat.uniforms.uNight.value = night;
    A.groundMat.emissiveIntensity = (0.35 + 0.5 * night) * (0.7 + 0.5 * pulse);
    rise.uAge.value = a;
    const u = glowMat.uniforms; u.uTime.value = t; u.uAge.value = a; u.uNight.value = night; u.uH.value = state.size.height * state.viewport.dpr;
    const d = dome.current, c = core.current, f = fx.current;
    if (d) {
      const k = ease.out3((a - 0.35) / 1.0);
      d.visible = k > 0; d.position.y = -A.DOME_R * 0.9 * (1 - k); d.scale.setScalar(0.4 + 0.6 * k);
    }
    if (c) {
      const k = a > 1.3 ? ease.back((a - 1.3) / 0.6) : 0;
      c.visible = k > 0.001; c.scale.setScalar(Math.max(k, 0.001) * (1 + 0.05 * pulse));
    }
    if (f) { f.visible = building; fxMat.uniforms.uAge.value = a; }
  });

  return (
    <group position={[0, p.top, 0]} rotation={[0, rot, 0]} scale={p.radius}>
      <mesh geometry={A.ground} material={A.groundMat} receiveShadow />
      <group position={[0, 0.05, 0]}>
      <mesh ref={structs} geometry={A.structures} material={rise.mat} castShadow receiveShadow />
      <mesh ref={dome} geometry={A.dome} material={A.domeMat} position={[0, 0.12, 0]} renderOrder={3} />
      <mesh ref={core} geometry={A.core} material={A.coreMat} position={[0, 0.25, 0]} />
      <mesh ref={fx} geometry={A.fx} material={fxMat} renderOrder={6} visible={p.fresh} />
      <points ref={glow} geometry={glowGeo} material={glowMat} frustumCulled={false} renderOrder={8} />
      </group>
    </group>
  );
}
