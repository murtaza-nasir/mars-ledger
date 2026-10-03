// Greenery, Detailed set (engine tile type 0): a lush layered forest. Oaks, spruce, birch, teal Martian cultivars and
// tree ferns with trunk -> limb -> leaf-clump structure; undergrowth (ferns, flowers, shrubs, grass, mushrooms), mossy
// rocks and fallen logs; a pond and stream with ripples, lily pads and glints; layered wind; dappled light, morning mist
// and light shafts by day; fireflies and bioluminescence by night; birds and butterflies. The owner's lantern stands
// at the rim. Build-in: seeds burst, the moss spreads, saplings shoot up and leaf out, then wildlife arrives.
import {useFrame} from '@react-three/fiber';
import {useEffect, useMemo} from 'react';
import * as THREE from 'three';
import {PLAYER_HEX} from '../../../../../../shared/game';
import {TILE} from '../../../../../../shared/full';
import {seeded, world} from '../../tiles3d';
import type {ModelMeta, ModelProps} from '../contract';
import {PT, makeFx, pointsMesh, tickFx} from '../FoliageKit';
import {critters, mistMesh} from './FoliageLife';
import {groundMaterial, vegMaterial} from './FoliageMat';
import {hashStr} from './FoliageLayout';
import {planGreenery} from './FoliageGreenery';

export const meta: ModelMeta = {set: 'detailed', name: 'Greenery (Detailed)', tileTypes: [TILE.GREENERY], kind: 'greenery', buildSeconds: 4.2};

const VARIANTS = 5;

export default function Greenery(p: ModelProps) {
  const R = p.radius;
  const lod = p.detail === 'lite' ? 'lite' : 'full';
  const accent = PLAYER_HEX[p.color ?? ''] ?? '#9be8a0';
  const S = useMemo(() => {
    const idh = hashStr(p.id);
    const variant = idh % VARIANTS, turn = [0, 1, 0, -1, 0, 0][Math.floor(idh / VARIANTS) % 6];
    const plan = planGreenery(variant, lod, R);
    const rnd = seeded(p.id, 31), fx = makeFx(R);
    const full = lod === 'full';
    const vegMat = vegMaterial(fx, {owner: accent, key: 'g', tint: 0});
    const gMat = groundMaterial(fx, {c1: '#1d4a1f', c2: '#4e9230', c3: '#8cc044', owner: accent, water: plan.water, waterColor: '#2a96a8', pads: true, seed: variant * 9.7, spread: true, litter: 0.55, flowers: ['#fff0a0', '#ffb0d8', '#ffffff'], key: 'g'});
    const ground = new THREE.Mesh(plan.ground, gMat); ground.position.y = 0.0015; ground.frustumCulled = false;
    const trees = new THREE.Mesh(plan.trees, vegMat); trees.frustumCulled = false;
    const props = new THREE.Mesh(plan.props, vegMat); props.frustumCulled = false;
    const [lx, lz] = plan.lantern;
    const cr = critters(fx, rnd, {birds: full ? 5 : 3, butterflies: full ? 8 : 3, R, birdHeight: 1.05, spread: 0.9});
    const mist = mistMesh(fx, {R, wisps: full ? 8 : 4, shafts: full ? 3 : 2, seed: rnd});
    const pts = pointsMesh(fx, rnd, [
      {kind: PT.POLLEN, n: full ? 22 : 8, size: R * 0.028, colors: ['#fff3c0', '#e8ffb0', '#ffffff'], alpha: 0.9},
      {kind: PT.FIREFLY, n: full ? 26 : 12, size: R * 0.04, colors: ['#5dffc8', '#9dff6a', '#7af0ff', '#ffe27a'], alpha: 1},
      {kind: PT.SPORE, n: full ? 56 : 24, size: R * 0.05, colors: ['#d4ff9a', '#9dff70', '#fff7b0'], alpha: 1},
      {kind: PT.HALO, n: 1, size: R * 0.24, colors: [accent], pos: () => [lx + R * 0.04, R * 0.21, lz], seed: () => [rnd(), 0.8, 0.5]},
    ]);
    return {fx, vegMat, gMat, ground, trees, props, cr, mist, pts, turn};
  }, [p.id, R, accent, lod]);
  useEffect(() => () => {
    S.vegMat.dispose(); S.gMat.dispose();
    [S.cr, S.mist, S.pts].forEach((x) => { x.geometry.dispose(); (x.material as THREE.Material).dispose(); });
  }, [S]);
  useFrame(({gl, size}) => tickFx(S.fx, p.age(), world.t, world.night, world.reduced, gl.getPixelRatio() * size.height, 1.2));
  return (
    <group position={[0, p.top, 0]} rotation={[0, S.turn * Math.PI / 3, 0]}>
      <primitive object={S.ground} />
      <primitive object={S.trees} />
      <primitive object={S.props} />
      <primitive object={S.cr} />
      <primitive object={S.mist} />
      <primitive object={S.pts} />
    </group>
  );
}
