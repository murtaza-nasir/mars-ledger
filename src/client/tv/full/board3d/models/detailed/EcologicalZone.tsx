// Ecological Zone, Detailed set (engine tile type 5): a terraced biome under a glass dome. Rock-walled terraces with
// strata, a lake with ripples, lily pads and reeds, nests with eggs and a sitting bird, boulders, research markers
// (tripod station, weather mast, survey stakes with owner-coloured flags), a small grove inside the dome, and a herd
// of antlered grazers that walk with moving legs, pause and graze. The dome is a faceted glass shell with a glowing
// owner collar. Build-in: terraces rise, trees shoot up, the dome inflates, the herd walks in.
import {useFrame} from '@react-three/fiber';
import {useEffect, useMemo} from 'react';
import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {PLAYER_HEX} from '../../../../../../shared/game';
import {TILE} from '../../../../../../shared/full';
import {seeded, world} from '../../tiles3d';
import type {ModelMeta, ModelProps} from '../contract';
import {PT, makeFx, pointsMesh, tickFx} from '../FoliageKit';
import {ECO, planEco} from './FoliageEco';
import {cached, hashStr} from './FoliageLayout';
import {critters, domeMaterial, grazerMesh, mistMesh} from './FoliageLife';
import {groundMaterial, vegMaterial} from './FoliageMat';

export const meta: ModelMeta = {set: 'detailed', name: 'Ecological Zone (Detailed)', tileTypes: [TILE.ECOLOGICAL_ZONE], kind: 'special', buildSeconds: 4.4};

const VARIANTS = 4;
const N_ANIM = 6;
const easeBack = (x: number) => { const c1 = 1.9, c3 = c1 + 1, m = Math.min(1, Math.max(0, x)) - 1; return x <= 0 ? 0 : 1 + c3 * m * m * m + c1 * m * m; };
const sstep = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

type Herd = {c: number; amp: number; r: number; dw: number; dp: number; off: number; s: number; dir: number};

export default function EcologicalZone(p: ModelProps) {
  const R = p.radius;
  const lod = p.detail === 'lite' ? 'lite' : 'full';
  const accent = PLAYER_HEX[p.color ?? ''] ?? '#9be8a0';
  const S = useMemo(() => {
    const idh = hashStr(p.id), variant = idh % VARIANTS, turn = [0, 1, 0, -1, 0, 0][Math.floor(idh / VARIANTS) % 6];
    const plan = planEco(variant, lod, R);
    const rnd = seeded(p.id, 53), fx = makeFx(R), full = lod === 'full';
    const vegMat = vegMaterial(fx, {owner: accent, key: 'e'});
    const gMat = groundMaterial(fx, {c1: '#2f5c24', c2: '#6ba43c', c3: '#b9cb55', owner: accent, water: plan.water, waterColor: '#2aa4b4', pads: true, rise: true, rimAt: ECO.RA * 0.866, rim: 0.9, seed: variant * 5.3, litter: 0.2, moss: 0.8, flowers: ['#fff0a0', '#ffffff', '#ffb0d8'], key: 'e'});
    const terr = new THREE.Mesh(plan.terrace, gMat); terr.frustumCulled = false;
    const meshes: THREE.Mesh[] = [];
    if (full) {
      const a = new THREE.Mesh(plan.trees, vegMat), b = new THREE.Mesh(plan.props, vegMat); a.frustumCulled = b.frustumCulled = false; meshes.push(a, b);
    } else {
      const merged = cached(`eco-merge|${variant}|${R}`, () => mergeGeometries([plan.trees, plan.props], false)!);
      const a = new THREE.Mesh(merged, vegMat); a.frustumCulled = false; meshes.push(a);
    }
    const domeMat = domeMaterial(fx, '#a8f0ff', accent);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1, full ? 40 : 28, full ? 14 : 8, 0, Math.PI * 2, 0, Math.PI / 2), domeMat);
    dome.position.y = ECO.TB * R; dome.scale.set(R * ECO.DOME, R * ECO.DOME * 1.05, R * ECO.DOME); dome.renderOrder = 8; dome.frustumCulled = false;
    const coats = ['#c99a62', '#e8d6b0', '#9a6a40', '#d8b27a', '#f1ead8', '#b07a4c'];
    const herd = grazerMesh(fx, N_ANIM, coats, !full);
    const lakeA = plan.lakeAngle;
    const hs: Herd[] = [];
    const lo = lakeA + 0.62, span = 2 * Math.PI - 1.24;
    for (let i = 0; i < N_ANIM; i++) {
      hs.push({c: lo + (i + 0.5) * span / N_ANIM, amp: 0.2 + rnd() * 0.08, r: ECO.WALK * R * (0.95 + rnd() * 0.08), dw: 4.5 + rnd() * 3, dp: 4 + rnd() * 4, off: rnd() * 60, s: R * (0.125 + rnd() * 0.05), dir: i % 2 ? 1 : -1});
    }
    const cr = critters(fx, rnd, {birds: full ? 4 : 2, butterflies: full ? 6 : 3, R, birdHeight: 0.42, spread: 0.5, hideAt: 2.4});
    cr.position.y = ECO.TB * R;
    const mist = full ? mistMesh(fx, {R, wisps: 5, shafts: 0, seed: rnd, height: 0.8}) : null;
    if (mist) mist.position.y = ECO.TA * R;
    const pts = pointsMesh(fx, rnd, [
      {kind: PT.POLLEN, n: full ? 18 : 8, size: R * 0.026, colors: ['#fff3c0', '#ffffff'], alpha: 0.8},
      {kind: PT.FIREFLY, n: full ? 20 : 10, size: R * 0.036, colors: ['#7affd8', '#b6ff7a', '#ffe27a'], alpha: 1},
      {kind: PT.SPORE, n: full ? 44 : 20, size: R * 0.045, colors: ['#bfffe0', '#d8ff9a'], alpha: 1},
      {kind: PT.HALO, n: 1, size: R * 1.1, colors: [accent], pos: () => [0, ECO.TB * R + R * 0.1, 0], seed: () => [rnd(), 0.2, 0.1]},
    ]);
    return {fx, vegMat, gMat, terr, meshes, domeMat, dome, herd, hs, cr, mist, pts, turn, o: new THREE.Object3D()};
  }, [p.id, R, accent, lod]);
  useEffect(() => () => {
    S.vegMat.dispose(); S.gMat.dispose(); S.domeMat.dispose(); S.dome.geometry.dispose();
    S.herd.mesh.dispose(); (S.herd.mesh.material as THREE.Material).dispose(); S.herd.mesh.geometry.dispose();
    [S.cr, S.pts, S.mist].forEach((x) => { if (x) { x.geometry.dispose(); (x.material as THREE.Material).dispose(); } });
  }, [S]);
  useFrame(({gl, size}) => {
    const a = p.age(), done = a === Infinity || a > 99;
    tickFx(S.fx, a, world.t, world.night, world.reduced, gl.getPixelRatio() * size.height, 1.6);
    const t = world.t, o = S.o, y = ECO.TA * R, st = S.herd.state;
    for (let i = 0; i < N_ANIM; i++) {
      const q = S.hs[i], cyc = q.dw + q.dp, tt = t + q.off, k = Math.floor(tt / cyc), rp = tt - k * cyc;
      const seq = [0, 1, 2, 1, 0, 1, 2, 1], ph = (j: number) => (j % 4 === 0 ? -1 : j % 4 === 2 ? 1 : 0);
      const from = ph(k % 4 === 0 ? 0 : k % 4 === 1 ? 1 : k % 4 === 2 ? 2 : 3), to = ph((k + 1) % 4);
      void seq;
      const moving = rp < q.dw, fr = moving ? sstep(0, 1, rp / q.dw) : 1;
      const wpA = (w: number) => q.c + w * q.amp;
      const ang = world.reduced ? wpA(0) : wpA(from + (to - from) * fr);
      const dirMove = to === from ? 1 : Math.sign(to - from);
      // heading: the direction of travel; during a pause it swings to the next leg's direction
      const k1 = k + 1, from1 = ph(k1 % 4), to1 = ph((k1 + 1) % 4), nextDir = to1 === from1 ? 1 : Math.sign(to1 - from1);
      const turnK = moving ? 0 : sstep(q.dp - 1.4, q.dp, rp - q.dw);
      const sdir = dirMove * q.dir;
      const nd = nextDir * q.dir;
      const yaw0 = Math.atan2(-Math.sin(ang) * sdir, Math.cos(ang) * sdir);
      const yaw = yaw0 + (nd !== sdir ? Math.PI * turnK : 0);
      const grazing = !moving && ((k + i) % 2 === 0) ? sstep(0.4, 1.4, rp - q.dw) * (1 - sstep(q.dp - 1.8, q.dp - 1.0, rp - q.dw)) : 0;
      const walkAmp = moving ? Math.min(1, Math.sin(Math.PI * rp / q.dw) * 2.2) : 0;
      const arrive = done ? 1 : easeBack((a - 2.2 - i * 0.14) / 0.45);
      o.position.set(Math.cos(ang) * q.r, y, Math.sin(ang) * q.r);
      o.rotation.set(0, yaw, 0);
      o.scale.setScalar(Math.max(0.0001, q.s * arrive));
      o.updateMatrix(); S.herd.mesh.setMatrixAt(i, o.matrix);
      st[i * 3] = world.reduced ? 0 : walkAmp; st[i * 3 + 1] = world.reduced ? 0 : grazing; st[i * 3 + 2] = (k * 4 + (moving ? fr * 4 : 4)) * 3.0 + i * 1.7;
    }
    S.herd.mesh.instanceMatrix.needsUpdate = true; S.herd.stateAttr.needsUpdate = true;
  });
  return (
    <group position={[0, p.top, 0]} rotation={[0, S.turn * Math.PI / 3, 0]}>
      <primitive object={S.terr} />
      {S.meshes.map((m, i) => <primitive key={i} object={m} />)}
      <primitive object={S.herd.mesh} />
      <primitive object={S.cr} />
      {S.mist && <primitive object={S.mist} />}
      <primitive object={S.dome} />
      <primitive object={S.pts} />
    </group>
  );
}
