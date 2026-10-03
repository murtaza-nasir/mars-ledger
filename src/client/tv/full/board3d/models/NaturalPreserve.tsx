// Natural Preserve (engine tile type 11): an untouched wild grove. Old conifers and gnarled broadleaf trees, moss
// and wildflowers, moss-streaked rock outcrops, and a standing-stone beacon in a clearing ringed by menhirs that sends
// up a soft beam of light in the owner's colour. Drifting glints (fireflies) pass through at night.
// Build-in: the ground spreads, rocks and stones thrust up, the old trees spring up in a wave, the beacon ignites.
import {useFrame} from '@react-three/fiber';
import {useEffect, useMemo} from 'react';
import * as THREE from 'three';
import {PLAYER_HEX} from '../../../../../shared/game';
import {TILE} from '../../../../../shared/full';
import {seeded, world} from '../tiles3d';
import type {ModelMeta, ModelProps} from './contract';
import {ROCK_SPOTS, beamMaterial, outcropGeo} from './FoliageGrove';
import {PT, broadGeo, coniferGeo, foliageMaterial, hexGround, makeFx, plant, pointsMesh, terrainMaterial, tickFx, treeMesh} from './FoliageKit';

export const meta: ModelMeta = {name: 'Natural Preserve', tileTypes: [TILE.NATURAL_PRESERVE], kind: 'special', buildSeconds: 2.1};

const BEACON_H = 0.7;

export default function NaturalPreserve(p: ModelProps) {
  const R = p.radius;
  const accent = PLAYER_HEX[p.color ?? ''] ?? '#9be8a0';
  const S = useMemo(() => {
    const rnd = seeded(p.id, 71), fx = makeFx(R);
    const f = plant(rnd, R, {n: 34 + Math.floor(rnd() * 6), conFrac: 0.45, shrubFrac: 0.2, keep: [{x: 0, z: 0, r: R * 0.4}, ...ROCK_SPOTS.map(([x, z, r]) => ({x: x * R, z: z * R, r: r * R * 2.1}))], spread: 0.92, gap: 0.1, tall: 0.8, slim: 0.62, wild: 0.6, hueShift: -0.01, accents: 0.14});
    const treeMat = foliageMaterial(fx, '#8dffd0', 1.2, '#9dffb0');
    const con = treeMesh(coniferGeo(), treeMat, f.con), broad = treeMesh(broadGeo(), treeMat, f.broad);
    const groundMat = terrainMaterial(fx, {mossy: true, mound: 0.1, spread: true, ripple: true, rim: 0.8, owner: accent, glow: 0.35, seed: rnd() * 40,
      c1: '#10281a', c2: '#2c5e24', c3: '#6a8f33', bio: '#6affc4', flowers: ['#ffd24a', '#ff8ab8']});
    const ground = new THREE.Mesh(hexGround(R * 0.995, 7), groundMat); ground.position.y = 0.0015; ground.frustumCulled = false;
    const rockMat = terrainMaterial(fx, {rise: true, riseDelay: 0.25, seed: rnd() * 30, roughness: 1, bio: '#6affc4'});
    const rocks = new THREE.Mesh(outcropGeo(R, rnd, R * BEACON_H), rockMat); rocks.frustumCulled = false;
    const beamMat = beamMaterial(fx, accent);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.03, R * 0.26, R * 1.1, 18, 1, true).translate(0, R * 0.55, 0), beamMat);
    beam.position.y = R * (BEACON_H + 0.14); beam.renderOrder = 7; beam.frustumCulled = false;
    const pts = pointsMesh(fx, rnd, [
      {kind: PT.POLLEN, n: 14, size: R * 0.028, colors: ['#fff3c0', '#e8ffb0'], alpha: 0.85},
      {kind: PT.FIREFLY, n: 22, size: R * 0.045, colors: ['#6affc8', '#b4ff6a', '#8ae8ff'], alpha: 1},
      {kind: PT.SPORE, n: 32, size: R * 0.05, colors: ['#d4ff9a', '#9dff70', '#fff7b0'], alpha: 1},
      {kind: PT.HALO, n: 1, size: R * 0.55, colors: [accent], pos: () => [0, R * (BEACON_H + 0.2), 0], seed: () => [rnd(), 0.75, 0.45]},
      {kind: PT.HALO, n: 1, size: R * 0.9, colors: [accent], pos: () => [0, R * 0.12, 0], seed: () => [rnd(), 0.18, 0.1]},
    ]);
    return {fx, con, broad, treeMat, ground, groundMat, rocks, rockMat, beam, beamMat, pts};
  }, [p.id, R, accent]);
  useEffect(() => () => {
    S.treeMat.dispose(); S.con.dispose(); S.broad.dispose(); S.ground.geometry.dispose(); S.groundMat.dispose();
    S.rocks.geometry.dispose(); S.rockMat.dispose(); S.beam.geometry.dispose(); S.beamMat.dispose(); S.pts.geometry.dispose(); (S.pts.material as THREE.Material).dispose();
  }, [S]);
  useFrame(({gl, size}) => tickFx(S.fx, p.age(), world.t, world.night, world.reduced, gl.getPixelRatio() * size.height, 1.4));
  return (
    <group position={[0, p.top, 0]}>
      <primitive object={S.ground} />
      <primitive object={S.rocks} />
      <primitive object={S.con} />
      <primitive object={S.broad} />
      <primitive object={S.beam} />
      <primitive object={S.pts} />
    </group>
  );
}
