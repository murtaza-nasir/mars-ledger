// Ecological Zone (engine tile type 5): a protected biome. Two stepped terraces, a glass dome over a lush grove,
// a shimmering lake, nests with eggs, a small herd that walks the outer terrace, birds and glints. The owner's colour
// runs along the terrace rim. Build-in: terraces rise, trees spring up, the dome inflates with a pop and a flash,
// the lake fills, the animals walk in.
import {useFrame} from '@react-three/fiber';
import {useEffect, useMemo} from 'react';
import * as THREE from 'three';
import {PLAYER_HEX} from '../../../../../shared/game';
import {TILE} from '../../../../../shared/full';
import {seeded, world} from '../tiles3d';
import type {ModelMeta, ModelProps} from './contract';
import {RAD_A, RAD_B, TER_A, TER_B, animalGeo, domeMaterial, lakeMaterial, terraceGeo} from './FoliageBiome';
import {PT, broadGeo, foliageMaterial, makeFx, plant, pointsMesh, terrainMaterial, tickFx, treeMesh} from './FoliageKit';

export const meta: ModelMeta = {name: 'Ecological Zone', tileTypes: [TILE.ECOLOGICAL_ZONE], kind: 'special', buildSeconds: 2.3};

const easeBack = (x: number) => { const c1 = 2.2, c3 = c1 + 1, m = Math.min(1, Math.max(0, x)) - 1; return 1 + c3 * m * m * m + c1 * m * m; };
const N_ANIMALS = 7;

export default function EcologicalZone(p: ModelProps) {
  const R = p.radius;
  const accent = PLAYER_HEX[p.color ?? ''] ?? '#9be8a0';
  const S = useMemo(() => {
    const rnd = seeded(p.id, 53), fx = makeFx(R);
    const terr = new THREE.Mesh(terraceGeo(R, rnd), terrainMaterial(fx, {rise: true, rim: 0.7, owner: accent, rimAt: RAD_A * 0.866, seed: rnd() * 30, roughness: 0.9, bio: '#38ffb8'}));
    terr.frustumCulled = false;
    const f = plant(rnd, R * RAD_B, {n: 13, conFrac: 0, shrubFrac: 0.3, spread: 0.84, gap: 0.22, tall: 0.95, hueShift: 0.03, accents: 0.28});
    const treeMat = foliageMaterial(fx, '#7dffd8', 1);
    const trees = treeMesh(broadGeo(), treeMat, f.broad);
    trees.position.y = TER_B * R;
    const lakeMat = lakeMaterial(fx);
    const lake = new THREE.Mesh(new THREE.CircleGeometry(1, 28).rotateX(-Math.PI / 2), lakeMat);
    lake.position.set(0.3 * R, TER_A * R + 0.004 * R, 0.6 * R); lake.scale.set(R * 0.23, 1, R * 0.12); lake.renderOrder = 3;
    const domeMat = domeMaterial(fx);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 8, 0, Math.PI * 2, 0, Math.PI / 2), domeMat);
    dome.position.y = TER_B * R; dome.scale.set(R * 0.6, R * 0.64, R * 0.6); dome.renderOrder = 7;
    const animalMat = new THREE.MeshStandardMaterial({color: '#ffffff', roughness: 0.8, emissive: '#ffcf8a', emissiveIntensity: 0.0});
    const animals = new THREE.InstancedMesh(animalGeo(), animalMat, N_ANIMALS);
    const coat = ['#c99a62', '#e8d6b0', '#8a5a36', '#d8b27a', '#f1ead8', '#a8764a', '#7a5a42'];
    const ph: Array<{a: number; r: number; sp: number; s: number}> = [];
    for (let i = 0; i < N_ANIMALS; i++) {
      animals.setColorAt(i, new THREE.Color(coat[i % coat.length]));
      ph.push({a: rnd() * 6.28, r: R * (0.66 + rnd() * 0.1), sp: (0.05 + rnd() * 0.06) * (i % 2 ? 1 : -1), s: R * (0.11 + rnd() * 0.045)});
    }
    animals.frustumCulled = false;
    const pts = pointsMesh(fx, rnd, [
      {kind: PT.POLLEN, n: 12, size: R * 0.03, colors: ['#fff3c0', '#ffffff'], alpha: 0.8},
      {kind: PT.FIREFLY, n: 12, size: R * 0.04, colors: ['#7affd8', '#b6ff7a'], alpha: 1},
      {kind: PT.SPORE, n: 30, size: R * 0.045, colors: ['#bfffe0', '#d8ff9a'], alpha: 1},
      {kind: PT.BIRD, n: 5, size: R * 0.022, colors: ['#fff6d8'], pos: () => [0, TER_B * R + R * 0.45, 0], seed: () => [rnd(), rnd() * 0.6, rnd()], alpha: 1},
      // eye-shine of the herd at night: faint walking glints on the outer terrace
      {kind: PT.WALKER, n: 4, size: R * 0.02, colors: ['#ffe6a0', '#a8ffe0'], pos: () => [0, TER_A * R + R * 0.045, 0], seed: () => [rnd(), 0.95 + rnd() * 0.2, rnd()], alpha: 0.8},
    ]);
    return {fx, terr, trees, treeMat, lake, lakeMat, dome, domeMat, animals, animalMat, ph, pts, o: new THREE.Object3D()};
  }, [p.id, R, accent]);
  useEffect(() => () => {
    S.terr.geometry.dispose(); (S.terr.material as THREE.Material).dispose(); S.trees.dispose(); S.treeMat.dispose();
    S.lake.geometry.dispose(); S.lakeMat.dispose(); S.dome.geometry.dispose(); S.domeMat.dispose();
    S.animals.dispose(); S.animalMat.dispose(); S.pts.geometry.dispose(); (S.pts.material as THREE.Material).dispose();
  }, [S]);
  useFrame(({gl, size}) => {
    const a = p.age(), done = a === Infinity || a > 99;
    tickFx(S.fx, a, world.t, world.night, world.reduced, gl.getPixelRatio() * size.height, 1.5);
    const t = world.t, o = S.o, y = TER_A * R;
    for (let i = 0; i < N_ANIMALS; i++) {
      const q = S.ph[i], k = done ? 1 : easeBack((a - 1.5 - i * 0.07) / 0.35);
      const ang = q.a + q.sp * (t + 1.6 * Math.sin(t * 0.37 + i * 2.1));
      o.position.set(Math.cos(ang) * q.r, y + (world.reduced ? 0 : Math.abs(Math.sin(t * 5 + i)) * 0.004 * R), Math.sin(ang) * q.r);
      o.rotation.set(0, Math.atan2(-Math.sin(ang) * Math.sign(q.sp), Math.cos(ang) * Math.sign(q.sp)), 0);
      o.scale.setScalar(Math.max(0.0001, q.s * k));
      o.updateMatrix(); S.animals.setMatrixAt(i, o.matrix);
    }
    S.animals.instanceMatrix.needsUpdate = true;
    S.animalMat.emissiveIntensity = 0.12 + world.night * 0.35;
  });
  return (
    <group position={[0, p.top, 0]}>
      <primitive object={S.terr} />
      <primitive object={S.trees} />
      <primitive object={S.lake} />
      <primitive object={S.animals} />
      <primitive object={S.dome} />
      <primitive object={S.pts} />
    </group>
  );
}
