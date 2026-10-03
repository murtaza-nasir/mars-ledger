// Natural Preserve, Detailed set (engine tile type 11): wild old-growth. Towering fluted giants with moss, vines and
// buttress roots, a stratified cliff with a stepped waterfall into a pool and stream (spray, mist, lily pads), a ring of
// standing stones with glowing runes, and a ranger beacon tower whose lantern, sweeping blades and light column carry
// the owner's colour. Birds and butterflies, fireflies and bioluminescence by night, light shafts by day.
// Build-in: the ground spreads, the cliff and stones thrust up, the giants shoot up and leaf out, the beacon ignites,
// the water starts to fall and wildlife arrives.
import {useFrame} from '@react-three/fiber';
import {useEffect, useMemo} from 'react';
import * as THREE from 'three';
import {PLAYER_HEX} from '../../../../../../shared/game';
import {TILE} from '../../../../../../shared/full';
import {seeded, world} from '../../tiles3d';
import type {ModelMeta, ModelProps} from '../contract';
import {PT, makeFx, pointsMesh, tickFx} from '../FoliageKit';
import {hashStr} from './FoliageLayout';
import {beaconBeam, critters, mistMesh, waterfallMesh} from './FoliageLife';
import {groundMaterial, vegMaterial} from './FoliageMat';
import {mergeVeg, planPreserve} from './FoliagePreserve';

export const meta: ModelMeta = {set: 'detailed', name: 'Natural Preserve (Detailed)', tileTypes: [TILE.NATURAL_PRESERVE], kind: 'special', buildSeconds: 4.6};

const VARIANTS = 4;

export default function NaturalPreserve(p: ModelProps) {
  const R = p.radius;
  const lod = p.detail === 'lite' ? 'lite' : 'full';
  const accent = PLAYER_HEX[p.color ?? ''] ?? '#9be8a0';
  const S = useMemo(() => {
    const idh = hashStr(p.id), variant = idh % VARIANTS, turn = [0, 1, 0, -1, 0, 0][Math.floor(idh / VARIANTS) % 6];
    const plan = planPreserve(variant, lod, R);
    const rnd = seeded(p.id, 71), fx = makeFx(R), full = lod === 'full';
    const vegMat = vegMaterial(fx, {owner: accent, key: 'n', bio: '#6affc4'});
    const gMat = groundMaterial(fx, {c1: '#12301a', c2: '#2c6226', c3: '#68963a', owner: accent, bio: '#6affc4', water: plan.water, waterColor: '#2a8fa4', pads: true, seed: variant * 11.1, spread: true, litter: 0.85, moss: 1.1, flowers: ['#ffd24a', '#ff8ab8', '#ffffff'], key: 'n'});
    const ground = new THREE.Mesh(plan.ground, gMat); ground.position.y = 0.0015; ground.frustumCulled = false;
    const veg: THREE.Mesh[] = [];
    if (full) { const a = new THREE.Mesh(plan.trees, vegMat), b = new THREE.Mesh(plan.props, vegMat); a.frustumCulled = b.frustumCulled = false; veg.push(a, b); }
    else { const a = new THREE.Mesh(mergeVeg(plan, `${variant}|${R}`), vegMat); a.frustumCulled = false; veg.push(a); }
    const fall = waterfallMesh(fx, plan.fall, plan.fallW); fall.position.set(plan.fallAt[0], 0, plan.fallAt[1]);
    const beam = beaconBeam(fx, accent, R, R * 0.95); beam.position.set(plan.beacon[0], plan.beacon[1], plan.beacon[2]);
    const cr = full ? critters(fx, rnd, {birds: 4, butterflies: 5, R, birdHeight: 1.15, spread: 0.85}) : null;
    const mist = mistMesh(fx, {R, wisps: full ? 6 : 4, shafts: full ? 4 : 2, seed: rnd, at: [plan.poolAt[0] * 0.6, plan.poolAt[1] * 0.4], rad: 0.5, height: 1.2});
    const px = plan.fallAt[0], pz = plan.fallAt[1] + R * 0.17;
    const pts = pointsMesh(fx, rnd, [
      {kind: PT.POLLEN, n: full ? 20 : 8, size: R * 0.026, colors: ['#fff3c0', '#e8ffb0'], alpha: 0.85},
      {kind: PT.FIREFLY, n: full ? 30 : 14, size: R * 0.04, colors: ['#6affc8', '#b4ff6a', '#8ae8ff', '#ffe27a'], alpha: 1},
      {kind: PT.SPORE, n: full ? 56 : 24, size: R * 0.05, colors: ['#d4ff9a', '#9dff70', '#fff7b0'], alpha: 1},
      {kind: PT.HALO, n: 1, size: R * 0.5, colors: [accent], pos: () => [plan.beacon[0], plan.beacon[1], plan.beacon[2]], seed: () => [rnd(), 0.75, 0.45]},
      {kind: PT.HALO, n: 1, size: R * 0.9, colors: [accent], pos: () => [plan.beacon[0], R * 0.1, plan.beacon[2]], seed: () => [rnd(), 0.18, 0.1]},
      {kind: PT.HALO, n: 1, size: R * 0.3, colors: ['#cfeeff'], pos: () => [px, R * 0.05, pz], seed: () => [rnd(), 0.35, 0.5]},
      {kind: PT.HALO, n: 1, size: R * 0.22, colors: ['#cfeeff'], pos: () => [px + R * 0.08, R * 0.04, pz + R * 0.03], seed: () => [rnd(), 0.3, 0.5]},
    ]);
    return {fx, vegMat, gMat, ground, veg, fall, beam, cr, mist, pts, turn};
  }, [p.id, R, accent, lod]);
  useEffect(() => () => {
    S.vegMat.dispose(); S.gMat.dispose();
    [S.fall, S.beam, S.cr, S.mist, S.pts].forEach((x) => { if (x) { x.geometry.dispose(); (x.material as THREE.Material).dispose(); } });
  }, [S]);
  useFrame(({gl, size}) => tickFx(S.fx, p.age(), world.t, world.night, world.reduced, gl.getPixelRatio() * size.height, 1.4));
  return (
    <group position={[0, p.top, 0]} rotation={[0, S.turn * Math.PI / 3, 0]}>
      <primitive object={S.ground} />
      {S.veg.map((m, i) => <primitive key={i} object={m} />)}
      <primitive object={S.fall} />
      <primitive object={S.beam} />
      {S.cr && <primitive object={S.cr} />}
      <primitive object={S.mist} />
      <primitive object={S.pts} />
    </group>
  );
}
