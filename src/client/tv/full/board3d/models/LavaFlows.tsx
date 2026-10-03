// Lava Flows: a volcanic hex. Cracked basalt plates over glowing lava channels (a shader: Voronoi plates, rivers that
// radiate from a small cone, pulses of heat sliding outward), a crater with a churning pool, thrown sparks, lifted
// embers, a smoke plume lit from below, and the owner's beacon pylon. Build-in (~2 s): the ground shakes and flashes,
// the cone heaves up, and lava races out along the channels in fingers while a spark burst and smoke blast fly.
// Draw calls: ground, beacon, embers, smoke, halo, flash dome.
import {useFrame, useThree} from '@react-three/fiber';
import {useEffect, useMemo, useRef} from 'react';
import * as THREE from 'three';
import {PLAYER_HEX} from '../../../../../shared/game';
import {seeded, world} from '../tiles3d';
import type {ModelMeta, ModelProps} from './contract';
import {makeRigMaterial, Parts} from './MoholeBuild';
import {lavaDomeGeometry, lavaDomeMaterial, lavaEmberGeometry, lavaEmberMaterial, lavaGroundGeometry, lavaGroundMaterial, lavaHaloGeometry, lavaHaloMaterial, lavaSmokeGeometry, lavaSmokeMaterial} from './LavaShaders';

export const meta: ModelMeta = {name: 'Lava Flows', tileTypes: [7], kind: 'special', buildSeconds: 2.2};

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const easeOut = (x: number) => 1 - Math.pow(1 - clamp01(x), 3);
const easeBack = (x: number) => { const k = clamp01(x) - 1; return 1 + 2.2 * k * k * k + 1.2 * k * k; };

const BEACON: [number, number, number] = [-0.5, 0.5, 0.3];
let SHARED: {ground: THREE.BufferGeometry; halo: THREE.BufferGeometry; dome: THREE.BufferGeometry; beacon: THREE.BufferGeometry} | null = null;
function shared() {
  if (SHARED) return SHARED;
  const b = new Parts();
  const [x, , z] = BEACON;
  b.box(x, 0.035, z, 0.1, 0.07, 0.1, '#2b2c32');
  b.cyl(x, 0.25, z, 0.012, 0.02, 0.4, '#8d9099', {seg: 8});
  b.box(x, 0.12, z, 0.07, 0.025, 0.07, '#fff', {owner: 1, glow: 0.8});
  const orb = new THREE.IcosahedronGeometry(0.045, 0); b.geo(orb, '#fff', {x, y: 0.5, z, owner: 1, glow: 1.6, vary: 0}); orb.dispose();
  b.box(x + 0.07, 0.43, z, 0.12, 0.06, 0.008, '#fff', {owner: 1, glow: 0.7});
  SHARED = {ground: lavaGroundGeometry(), halo: lavaHaloGeometry(), dome: lavaDomeGeometry(), beacon: b.build()};
  return SHARED;
}

export default function LavaFlows(p: ModelProps) {
  const R = p.radius;
  const sh = useMemo(shared, []);
  const ownerHex = PLAYER_HEX[p.color ?? 'red'] ?? '#ffffff';
  const rotY = useMemo(() => seeded(p.id, 7)() * 6.283, [p.id]);
  const emb = useMemo(() => lavaEmberGeometry(44, 30, BEACON, seeded(p.id, 8)), [p.id]);
  const smk = useMemo(() => lavaSmokeGeometry(26, seeded(p.id, 9)), [p.id]);
  const fx = useMemo(() => ({ground: lavaGroundMaterial(), beacon: makeRigMaterial(), emb: lavaEmberMaterial(), smk: lavaSmokeMaterial(), halo: lavaHaloMaterial(), dome: lavaDomeMaterial()}), []);
  useEffect(() => () => { emb.dispose(); smk.dispose(); Object.values(fx).forEach((f) => f.mat.dispose()); }, [emb, smk, fx]);
  useEffect(() => { fx.beacon.u.uOwner.value.set(ownerHex); fx.emb.u.uOwner.value.set(ownerHex); }, [fx, ownerHex]);

  const grp = useRef<THREE.Group>(null);
  const dome = useRef<THREE.Mesh>(null);
  const size = useThree((s) => s.size), dpr = useThree((s) => s.viewport.dpr);

  useFrame(() => {
    const reduced = world.reduced;
    const a = reduced ? 1e9 : p.age();
    const done = a > 1e8;
    const t = reduced ? 3.1 : world.t;
    const n = p.night;
    const flash = done ? 0 : a > 0.15 ? Math.exp(-(a - 0.15) * 3.2) * clamp01((a - 0.15) / 0.07) : 0;
    const g = fx.ground.u;
    g.uT.value = t; g.uNight.value = n; g.uEmis.value = 1 + 0.55 * n + 0.1 * (reduced ? 0 : Math.sin(t * 1.7));
    g.uFlash.value = flash * 0.4;
    g.uFront.value = done ? 2 : easeOut((a - 0.2) / 1.5) * 1.5;
    g.uOpen.value = done ? 1 : easeOut((a - 0.2) / 1.2);
    g.uRise.value = done ? 1 : Math.max(0, easeBack((a - 0.18) / 0.8)) * (a < 0.18 ? 0 : 1);
    const h = fx.halo.u; h.uGlow.value = (0.1 + 0.6 * n) * clamp01(g.uOpen.value * 1.3); h.uFlash.value = flash * 0.9;
    for (const e of [fx.emb.u, fx.smk.u]) { e.uT.value = t; e.uAge.value = done ? 99 : a; e.uNight.value = n; e.uPx.value = size.height * dpr; }
    fx.beacon.u.uGlow.value = 0.6 + 0.9 * n; fx.beacon.u.uPulse.value = reduced ? 1 : 0.8 + 0.2 * Math.sin(t * 3);
    const d = dome.current;
    if (d) { const k = (a - 0.15) / 0.8; d.visible = !done && k > 0 && k < 1; const s = 0.3 + easeOut(k) * 0.95; d.scale.set(s, s * 0.8, s); fx.dome.u.uA.value = (1 - k) * (1 - k) * 0.45; }
    const m = grp.current;
    if (m) { const sh2 = !done && a < 0.9 ? Math.exp(-a * 3) * 0.012 : 0; m.position.x = Math.sin(a * 85) * sh2 * R; m.position.z = Math.cos(a * 71) * sh2 * R; }
  });

  return (
    <group position={[0, p.top, 0]}>
      <group ref={grp} scale={R} rotation={[0, rotY, 0]}>
        <mesh geometry={sh.ground} material={fx.ground.mat} />
        <mesh geometry={sh.halo} material={fx.halo.mat} renderOrder={1} />
        <mesh ref={dome} geometry={sh.dome} material={fx.dome.mat} renderOrder={2} visible={false} />
        <points geometry={emb} material={fx.emb.mat} renderOrder={4} frustumCulled={false} />
        <points geometry={smk} material={fx.smk.mat} renderOrder={3} frustumCulled={false} />
        <mesh geometry={sh.beacon} material={fx.beacon.mat} />
      </group>
    </group>
  );
}
