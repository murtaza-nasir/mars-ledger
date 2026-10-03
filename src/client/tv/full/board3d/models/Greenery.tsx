// Greenery (engine tile type 0): a dense, living engineered forest on Mars soil.
// ~40 instanced trees (conifers, broadleaf clumps, low shrubs) in two InstancedMeshes, a mossy ground that hides the
// hex top, layered wind sway / spring-up growth / dew glints / bioluminescent tips in the tree shader, drifting
// pollen and night fireflies, an owner lantern post, and a build-in: spores burst from the centre, a green ripple
// runs out, and the trees spring up in a wave with overshoot.
import {useFrame} from '@react-three/fiber';
import {useEffect, useMemo, useRef} from 'react';
import * as THREE from 'three';
import {PLAYER_HEX} from '../../../../../shared/game';
import {TILE} from '../../../../../shared/full';
import {seeded, world} from '../tiles3d';
import type {ModelMeta, ModelProps} from './contract';
import {PT, broadGeo, coniferGeo, foliageMaterial, hexGround, makeFx, plant, pointsMesh, terrainMaterial, tickFx, treeMesh} from './FoliageKit';

export const meta: ModelMeta = {name: 'Greenery', tileTypes: [TILE.GREENERY], kind: 'greenery', buildSeconds: 2.0};

const easeBack = (x: number) => { const c1 = 2.2, c3 = c1 + 1, m = Math.min(1, Math.max(0, x)) - 1; return 1 + c3 * m * m * m + c1 * m * m; };

export default function Greenery(p: ModelProps) {
  const R = p.radius;
  const accent = PLAYER_HEX[p.color ?? ''] ?? '#9be8a0';
  const marker = useRef<THREE.Group>(null);
  const orb = useRef<THREE.Mesh>(null);
  const S = useMemo(() => {
    const rnd = seeded(p.id, 31), fx = makeFx(R);
    const post: Array<{x: number; z: number; r: number}> = [{x: 0, z: R * 0.78, r: R * 0.13}];
    const f = plant(rnd, R, {n: 36 + Math.floor(rnd() * 9), conFrac: 0.5, keep: post, spread: 0.9, gap: 0.095, hueShift: (rnd() - 0.5) * 0.04, accents: 0.1});
    const tree = foliageMaterial(fx, '#47ffc4', 1);
    const con = treeMesh(coniferGeo(), tree, f.con), broad = treeMesh(broadGeo(), tree, f.broad);
    const groundMat = terrainMaterial(fx, {mossy: true, mound: 0.06, spread: true, ripple: true, rim: 0.9, owner: accent, seed: rnd() * 40,
      c1: '#16391a', c2: '#3f7a27', c3: '#7da83a', bio: '#38ffb8', flowers: ['#fff0a0', '#ffb0d8']});
    const ground = new THREE.Mesh(hexGround(R * 0.995, 7), groundMat);
    ground.position.y = 0.0015; ground.frustumCulled = false;
    const mz = post[0].z;
    const postGeo = new THREE.CylinderGeometry(R * 0.012, R * 0.018, R * 0.25, 6); postGeo.translate(0, R * 0.125, 0);
    const postM = new THREE.Mesh(postGeo, new THREE.MeshStandardMaterial({color: '#2b2622', emissive: accent, emissiveIntensity: 0.55, roughness: 0.6, metalness: 0.4}));
    const orbGeo = new THREE.IcosahedronGeometry(R * 0.032, 1);
    const orbMat = new THREE.MeshBasicMaterial({color: accent, toneMapped: false});
    const orbM = new THREE.Mesh(orbGeo, orbMat);
    const ringGeo = new THREE.TorusGeometry(R * 0.05, R * 0.006, 5, 14); ringGeo.rotateX(Math.PI / 2); ringGeo.translate(0, R * 0.2, 0);
    const ringM = new THREE.Mesh(ringGeo, orbMat); orbM.position.y = R * 0.28;
    const pts = pointsMesh(fx, rnd, [
      {kind: PT.POLLEN, n: 16, size: R * 0.03, colors: ['#fff3c0', '#e8ffb0', '#ffffff'], alpha: 0.9},
      {kind: PT.FIREFLY, n: 14, size: R * 0.045, colors: ['#5dffc8', '#9dff6a', '#7af0ff'], alpha: 1},
      {kind: PT.SPORE, n: 36, size: R * 0.05, colors: ['#d4ff9a', '#9dff70', '#fff7b0'], alpha: 1},
    ]);
    const halo = pointsMesh(fx, rnd, [{kind: PT.HALO, n: 1, size: R * 0.22, colors: [accent], pos: () => [0, R * 0.28, 0], seed: () => [rnd(), 0.8, 0.5]}]);
    const g = new THREE.Group(); g.position.set(0, 0, mz); g.add(postM, orbM, ringM, halo);
    return {ringM, fx, con, broad, tree, ground, groundMat, pts, g, postM, orbM, orbMat, halo, mz};
  }, [p.id, R, accent]);
  useEffect(() => () => {
    S.tree.dispose(); S.groundMat.dispose(); S.ground.geometry.dispose(); S.postM.geometry.dispose(); (S.postM.material as THREE.Material).dispose();
    S.orbM.geometry.dispose(); S.ringM.geometry.dispose(); S.orbMat.dispose(); [S.pts, S.halo].forEach((x) => { x.geometry.dispose(); (x.material as THREE.Material).dispose(); });
    S.con.dispose(); S.broad.dispose();
  }, [S]);
  const base = useMemo(() => new THREE.Color(accent), [accent]);
  useFrame(({gl, size}) => {
    const a = p.age();
    tickFx(S.fx, a, world.t, world.night, world.reduced, gl.getPixelRatio() * size.height);
    const k = a === Infinity || a > 99 ? 1 : easeBack((a - 1.0) / 0.5);
    S.g.scale.setScalar(Math.max(0.0001, k));
    const pulse = world.reduced ? 1 : 1 + 0.18 * Math.sin(world.t * 2.2);
    S.orbMat.color.copy(base).multiplyScalar((0.9 + world.night * 0.9) * pulse);
  });
  void marker; void orb;
  return (
    <group position={[0, p.top, 0]}>
      <primitive object={S.ground} />
      <primitive object={S.con} />
      <primitive object={S.broad} />
      <primitive object={S.g} />
      <primitive object={S.pts} />
    </group>
  );
}
