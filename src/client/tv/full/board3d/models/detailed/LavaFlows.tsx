// Lava Flows (Detailed): a volcanic vent field across the whole hex. A steep cone with a churning crater pool, spatter and
// bombs; five braided lava rivers whose skin crusts into drifting plates over incandescent cracks; levees, ropey banks and
// glowing fissures in the cooled basalt; a stand of basalt columns; ash plume, sparks and embers; and a scientific
// monitoring post (tripod, shelter, solar array, yagi, dish, seismometer, turning anemometer) in the owner colour.
// Build-in (~3.6 s): the ground shakes, the cone heaves up and erupts (flash, shock dome, bombs, ash blast), the lava
// advances along the channels, the columns rise, the post is raised and its beacons light.
// full: 8 draw calls (ground, halo, dome, points, columns, spatter, post, anemometer). lite: 5 (+ the dome while building).
import {useFrame, useThree} from '@react-three/fiber';
import {useEffect, useMemo, useRef} from 'react';
import * as THREE from 'three';
import {PLAYER_HEX} from '../../../../../../shared/game';
import {seeded, world} from '../../tiles3d';
import type {ModelMeta, ModelProps} from '../contract';
import {lavaDomeGeometry, lavaDomeMaterial, lavaHaloGeometry, lavaHaloMaterial} from '../LavaShaders';
import {lavaPointsGeometry, lavaPointsMaterial} from './LavaFX';
import {lavaGroundGeometry, lavaGroundMaterial} from './LavaGround';
import {lavaScene, MAST_TOP} from './LavaScene';
import {moleMaterial} from './MoholeKit';

export const meta: ModelMeta = {set: 'detailed', name: 'Lava Flows (Detailed)', tileTypes: [7], kind: 'special', buildSeconds: 3.6};

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const easeOut = (x: number) => 1 - Math.pow(1 - clamp01(x), 3);
const easeBack = (x: number) => { const k = clamp01(x) - 1; return 1 + 2.2 * k * k * k + 1.2 * k * k; };

const GROUND: Record<string, THREE.BufferGeometry> = {};
const groundGeo = (full: boolean) => GROUND[full ? 'f' : 'l'] ??= full ? lavaGroundGeometry(40, 96) : lavaGroundGeometry(18, 48);
let HALO: THREE.BufferGeometry | null = null, DOME: THREE.BufferGeometry | null = null;

export default function LavaFlows(p: ModelProps) {
  const R = p.radius;
  const full = p.detail !== 'lite';
  const sc = useMemo(() => lavaScene(full), [full]);
  const ownerHex = PLAYER_HEX[p.color ?? 'red'] ?? '#ffffff';
  // whole hex turns only (60 degrees): the detailed ground fills the hex footprint, so any other yaw leaves its edges off the tile
  const rotY = useMemo(() => Math.floor(seeded(p.id, 7)() * 6) * (Math.PI / 3), [p.id]);
  const pts = useMemo(() => lavaPointsGeometry(full ? {sparks: 60, embers: 40, ash: 30, bombs: 7} : {sparks: 26, embers: 16, ash: 14, bombs: 4}, sc.beacons, seeded(p.id, 8)), [p.id, sc, full]);
  const fx = useMemo(() => {
    const rig = moleMaterial();
    return {ground: lavaGroundMaterial(!full), rig, rigPost: moleMaterial(rig.u), rigSpin: moleMaterial(rig.u), rigSpat: moleMaterial(rig.u), pts: lavaPointsMaterial(), halo: lavaHaloMaterial(), dome: lavaDomeMaterial()};
  }, [full]);
  useEffect(() => () => { pts.dispose(); fx.ground.mat.dispose(); fx.rig.mat.dispose(); fx.rigPost.mat.dispose(); fx.rigSpin.mat.dispose(); fx.rigSpat.mat.dispose(); fx.pts.mat.dispose(); fx.halo.mat.dispose(); fx.dome.mat.dispose(); }, [pts, fx]);
  useEffect(() => { fx.rig.u.uOwner.value.set(ownerHex); fx.pts.u.uOwner.value.set(ownerHex); }, [fx, ownerHex]);

  const grp = useRef<THREE.Group>(null), dome = useRef<THREE.Mesh>(null);
  const rocksRef = useRef<THREE.Mesh>(null), postRef = useRef<THREE.Mesh>(null), spinRef = useRef<THREE.Mesh>(null);
  const size = useThree((s) => s.size), dpr = useThree((s) => s.viewport.dpr);

  useFrame(() => {
    const reduced = world.reduced;
    const a = reduced ? 1e9 : p.age();
    const done = a > 1e8;
    const t = reduced ? 3.1 : world.t;
    const n = p.night;
    const flash = done ? 0 : a > 0.15 ? Math.exp(-(a - 0.15) * 3.0) * clamp01((a - 0.15) / 0.07) : 0;
    const g = fx.ground.u;
    g.uT.value = t; g.uNight.value = n; g.uEmis.value = 1 + 0.6 * n + 0.1 * (reduced ? 0 : Math.sin(t * 1.7));
    g.uFlash.value = flash * 0.4; g.uBurst.value = done ? 0 : flash * 0.5;
    g.uFront.value = done ? 2 : easeOut((a - 0.45) / 2.6) * 1.75;
    g.uOpen.value = done ? 1 : easeOut((a - 0.2) / 1.4);
    g.uRise.value = done ? 1 : a < 0.18 ? 0 : Math.max(0, easeBack((a - 0.18) / 1.0));
    const h = fx.halo.u; h.uGlow.value = (0.12 + 0.65 * n) * clamp01(g.uOpen.value * 1.3); h.uFlash.value = flash * 0.9;
    const pu = fx.pts.u; pu.uT.value = t; pu.uAge.value = done ? 99 : a; pu.uNight.value = n; pu.uPx.value = size.height * dpr;
    const postK = done ? 1 : easeBack((a - 2.1) / 0.9);
    pu.uLights.value = done || a > 3.0 ? 1 : 0;
    const u = fx.rig.u; u.uGlow.value = 0.5 + 0.9 * n; u.uPulse.value = reduced ? 1 : 0.9 + 0.1 * Math.sin(t * 2.3); u.uShaft.value = (0.7 + 1.0 * n) * clamp01(g.uOpen.value * 1.2); u.uT.value = t;
    const rk = done ? 1 : easeBack((a - 1.1) / 0.9);
    const rocks = rocksRef.current;
    if (rocks) { rocks.visible = rk > 0.01; rocks.scale.set(1, Math.max(0.001, rk), 1); }
    const post = postRef.current;
    if (post) { post.visible = postK > 0.01; post.scale.set(1, Math.max(0.001, postK), 1); }
    const sp = spinRef.current;
    if (sp) { sp.visible = done || postK >= 1; sp.rotation.y = reduced ? 0.4 : t * 5.2; }
    const d = dome.current;
    if (d) { const k = (a - 0.15) / 0.8; d.visible = !done && k > 0 && k < 1; const s = 0.3 + easeOut(k) * 0.95; d.scale.set(s, s * 0.8, s); fx.dome.u.uA.value = (1 - k) * (1 - k) * 0.45; }
    const m = grp.current;
    if (m) { const sh = !done && a < 1.0 ? Math.exp(-a * 2.6) * 0.012 : 0; m.position.x = Math.sin(a * 85) * sh * R; m.position.z = Math.cos(a * 71) * sh * R; }
  });

  const [px, pz] = sc.postPos;
  return (
    <group position={[0, p.top, 0]}>
      <group ref={grp} scale={R} rotation={[0, rotY, 0]}>
        <mesh geometry={groundGeo(full)} material={fx.ground.mat} />
        <mesh geometry={(HALO ??= lavaHaloGeometry())} material={fx.halo.mat} renderOrder={1} />
        <mesh ref={dome} geometry={(DOME ??= lavaDomeGeometry())} material={fx.dome.mat} renderOrder={2} visible={false} />
        <mesh ref={rocksRef} geometry={sc.rocks} material={fx.rig.mat} />
        {full && sc.spatter && <mesh geometry={sc.spatter} material={fx.rigSpat.mat} />}
        <mesh ref={postRef} geometry={sc.post} material={fx.rigPost.mat} />
        {full && sc.spin && <mesh ref={spinRef} geometry={sc.spin} material={fx.rigSpin.mat} position={[px, MAST_TOP + 0.003, pz]} />}
        <points geometry={pts} material={fx.pts.mat} renderOrder={4} frustumCulled={false} />
      </group>
    </group>
  );
}
