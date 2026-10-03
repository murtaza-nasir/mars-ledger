// Nuclear Zone, Detailed set (engine tile 12): a fission complex. A containment dome of lattice panels with a pulsing
// core seen through its ports; two hyperboloid cooling towers rolling vapour; two turbine halls; a transformer yard whose
// insulators spark and arc; lattice pylons with cables leaving the tile; a stack; patrol vehicles circling the ring
// road; radiation-scarred ground (craters, fused glass, glowing cracks, hazard markings); owner-colour beacons.
// Draw calls, full: ground, structures, dome, core, arcs, glow points = 6 (+1 flash during the build-in).
// Draw calls, lite: ground, structures, dome, core, glow points = 5 (+1 flash during the build-in).
// Build-in (~2.8 s): a flash and ground blast, the towers and halls rise, the dome lifts out of the ground, cables drop in
// and the core ignites with a shock ring.
import {useFrame} from '@react-three/fiber';
import {useEffect, useMemo, useRef} from 'react';
import * as THREE from 'three';
import {PLAYER_HEX} from '../../../../../../shared/game';
import {seeded, world} from '../../tiles3d';
import type {ModelMeta, ModelProps} from '../contract';
import {DOME_R, DOME_Y, nuclearArcs, nuclearAssets, nuclearGlow} from './NuclearDetail';
import {detailMaterial, ease, glowMaterial} from './NuclearKit';

export const meta: ModelMeta = {set: 'detailed', name: 'Nuclear Zone (detailed)', tileTypes: [12], kind: 'special', buildSeconds: 2.8};

const BUILD = 3.0;

export default function NuclearZone(p: ModelProps) {
  const lite = p.detail === 'lite';
  const A = nuclearAssets();
  const owner = PLAYER_HEX[p.color ?? 'red'] ?? '#ff4a3a';
  const rot = useMemo(() => Math.floor(seeded(p.id, 4)() * 6) * (Math.PI / 3), [p.id]);
  const glowGeo = useMemo(() => nuclearGlow(owner, seeded(p.id, 9), lite), [p.id, owner, lite]);
  const arcGeo = useMemo(() => (lite ? null : nuclearArcs()), [lite]);
  const structGeo = useMemo(() => A.structures(owner, lite), [A, owner, lite]);
  const domeGeo = useMemo(() => A.dome(lite), [A, lite]);
  const dm = useMemo(() => detailMaterial({roughness: 0.6, metalness: 0.2}), []);
  const glowMat = useMemo(() => glowMaterial(), []);
  const fxMat = useMemo(() => A.fxMat.clone(), [A]);
  const domeMat = useMemo(() => {
    // per instance: its own uniforms (age), same compiled program
    const m = A.makeDome();
    return m;
  }, [A]);
  useEffect(() => () => { glowGeo.dispose(); arcGeo?.dispose(); dm.mat.dispose(); dm.depth.dispose(); domeMat.mat.dispose(); glowMat.dispose(); fxMat.dispose(); }, [glowGeo, arcGeo, dm, domeMat, glowMat, fxMat]);

  const domeRef = useRef<THREE.Mesh>(null), core = useRef<THREE.Mesh>(null), fx = useRef<THREE.Mesh>(null);
  const nightRef = useRef(p.night); nightRef.current = p.night;

  useFrame((state) => {
    const t = world.t, a = world.reduced ? 999 : p.age();
    const night = nightRef.current, pulse = 0.5 + 0.5 * Math.sin(t * 1.15);
    const spin = world.reduced ? 0 : t;
    A.coreMat.uniforms.uTime.value = t; A.coreMat.uniforms.uNight.value = night;
    A.arcMat.uniforms.uTime.value = t; A.arcMat.uniforms.uNight.value = night;
    A.groundMat.emissiveIntensity = (0.16 + 0.84 * night) * (0.75 + 0.45 * pulse);
    for (const m of [dm, domeMat]) { m.u.uAge.value = a; m.u.uSpin.value = spin; m.u.uGl.value = 0.15 + 1.35 * night; }
    const u = glowMat.uniforms; u.uTime.value = t; u.uAge.value = a; u.uNight.value = night; u.uH.value = state.size.height * state.viewport.dpr;
    const d = domeRef.current, c = core.current, f = fx.current;
    if (d) {
      const k = ease.out3((a - 0.4) / 1.1);
      d.visible = k > 0; d.position.y = DOME_Y - DOME_R * 0.95 * (1 - k); d.scale.setScalar(0.5 + 0.5 * k);
    }
    if (c) {
      const k = a > 1.6 ? ease.back((a - 1.6) / 0.6) : 0;
      c.visible = k > 0.001; c.scale.setScalar(Math.max(k, 0.001) * (1 + 0.05 * pulse));
    }
    if (f) { f.visible = a < BUILD; fxMat.uniforms.uAge.value = a; }
  });

  return (
    <group position={[0, p.top, 0]} rotation={[0, rot, 0]} scale={p.radius}>
      <mesh geometry={lite ? A.groundLite : A.groundFull} material={A.groundMat} receiveShadow />
      <group position={[0, 0.012, 0]}>
        <mesh geometry={structGeo} material={dm.mat} customDepthMaterial={dm.depth} castShadow receiveShadow frustumCulled={false} />
        <mesh ref={domeRef} geometry={domeGeo} material={domeMat.mat} position={[0, DOME_Y, 0]} frustumCulled={false} />
        <mesh ref={core} geometry={lite ? A.coreLite : A.core} material={A.coreMat} position={[0, DOME_Y + 0.095, 0]} />
        {arcGeo && <mesh geometry={arcGeo} material={A.arcMat} renderOrder={7} frustumCulled={false} />}
        <mesh ref={fx} geometry={A.fx} material={fxMat} renderOrder={6} visible={p.fresh} frustumCulled={false} />
        <points geometry={glowGeo} material={glowMat} frustumCulled={false} renderOrder={8} />
      </group>
    </group>
  );
}
