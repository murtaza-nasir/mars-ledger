// Mohole Area (Detailed): a monumental borehole. A terraced rim cut by service roads with haulers parked and circling,
// a lattice drill derrick with turning sheaves, a drawworks and a spinning drill string, a yard of control buildings
// with lit windows, tanks, heat exchangers with turning fans and steaming vents, pipe runs into a deep shaft (coloured
// strata, ladders, platforms, a molten floor), warning beacons in the owner colour.
// Build-in (~3.6 s): the ground breaks (the rim heaves up with a shockwave), the shaft bores open in a flash, the yard
// drops in and the haulers drive on, the derrick rises, the drill string lowers and spins up.
// full: 11 draw calls. lite: 6 (rim, yard, derrick, shaft, ground glow, steam/beacons) with the same layout and lights.
import {useFrame, useThree} from '@react-three/fiber';
import {useEffect, useMemo, useRef} from 'react';
import * as THREE from 'three';
import {PLAYER_HEX} from '../../../../../../shared/game';
import {seeded, world} from '../../tiles3d';
import type {ModelMeta, ModelProps} from '../contract';
import {columnGeometry, columnMaterial, groundFxGeometry, groundFxMaterial} from '../MoholeFX';
import {moleMaterial, type MoleU} from './MoholeKit';
import {moleScene, TOWER_TOP} from './MoholeScene';
import {pointsGeometry, pointsMaterial, shaftMaterial, SHAFT_R, SHAFT_Y} from './MoholeShaft';

export const meta: ModelMeta = {set: 'detailed', name: 'Mohole Area (Detailed)', tileTypes: [10], kind: 'special', buildSeconds: 3.6};

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const easeOut = (x: number) => 1 - Math.pow(1 - clamp01(x), 3);
const easeBack = (x: number) => { const k = clamp01(x) - 1; return 1 + 2.4 * k * k * k + 1.4 * k * k; };
const easeBounce = (x: number) => { x = clamp01(x); const n = 7.5625, d = 2.75;
  if (x < 1 / d) return n * x * x; if (x < 2 / d) { x -= 1.5 / d; return n * x * x + 0.75; } if (x < 2.5 / d) { x -= 2.25 / d; return n * x * x + 0.9375; } x -= 2.625 / d; return n * x * x + 0.984375; };

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const AX_Y = new THREE.Vector3(0, 1, 0), AX_Z = new THREE.Vector3(0, 0, 1);

let SHAFT_GEO: THREE.BufferGeometry | null = null;
const shaftGeo = () => SHAFT_GEO ??= (() => { const g = new THREE.CircleGeometry(SHAFT_R, 48); g.rotateX(-Math.PI / 2); g.translate(0, SHAFT_Y, 0); return g; })();

export default function Mohole(p: ModelProps) {
  const R = p.radius;
  const full = p.detail !== 'lite';
  const sc = useMemo(() => moleScene(full), [full]);
  const ownerHex = PLAYER_HEX[p.color ?? 'red'] ?? '#ffffff';
  const yaw = useMemo(() => (seeded(p.id, 3)() - 0.5) * 0.7, [p.id]);
  const pts = useMemo(() => pointsGeometry(sc.lights, sc.vents, full ? 40 : 22, full ? 36 : 14, full ? 7 : 4, seeded(p.id, 4)), [p.id, sc, full]);
  const fx = useMemo(() => {
    const rig = moleMaterial();
    const shared: MoleU = rig.u;
    return {rig: rig.mat, u: shared, shaft: shaftMaterial(!full), column: columnMaterial(), ground: groundFxMaterial(), points: pointsMaterial(), gearMat: moleMaterial(shared).mat, fanMat: moleMaterial(shared).mat, drillMat: moleMaterial(shared).mat, convoyMat: moleMaterial(shared).mat, rimMat: moleMaterial(shared).mat};
  }, [full]);
  useEffect(() => () => {
    pts.dispose();
    for (const m of [fx.rig, fx.gearMat, fx.fanMat, fx.drillMat, fx.convoyMat, fx.rimMat, fx.shaft.mat, fx.column.mat, fx.ground.mat, fx.points.mat]) m.dispose();
  }, [pts, fx]);
  useEffect(() => {
    fx.u.uOwner.value.set(ownerHex); fx.shaft.u.uOwner.value.set(ownerHex); fx.column.u.uOwner.value.set(ownerHex); fx.points.u.uOwner.value.set(ownerHex);
  }, [fx, ownerHex]);

  const rimRef = useRef<THREE.Mesh>(null), depotRef = useRef<THREE.Mesh>(null), towerRef = useRef<THREE.Mesh>(null);
  const gearsRef = useRef<THREE.InstancedMesh>(null), fansRef = useRef<THREE.InstancedMesh>(null);
  const drillRef = useRef<THREE.Mesh>(null), convoyRef = useRef<THREE.Mesh>(null), colRef = useRef<THREE.Mesh>(null);
  const size = useThree((s) => s.size), dpr = useThree((s) => s.viewport.dpr);

  useFrame(() => {
    const reduced = world.reduced;
    const a = reduced ? 1e9 : p.age();
    const done = a > 1e8;
    const t = reduced ? 4.2 : world.t;
    const n = p.night;
    // timeline: stamp 0..0.35, shockwave 0.3.., bore 0.35..1.4 (flash 0.45), yard 0.9..1.9, convoy 1.2..2.6,
    // derrick 1.3..2.9, drill lowers 2.7..3.5 and spins up, beacons light when the derrick tops out
    const rimK = done ? 1 : easeBack((a - 0.0) / 0.55);
    const yardK = done ? 1 : (a - 0.9) / 0.9;
    const towerK = done ? 1 : easeOut((a - 1.3) / 1.5);
    const topped = done || towerK > 0.985;
    const drillK = done ? 1 : clamp01((a - 2.7) / 0.9);
    const rim = rimRef.current, depot = depotRef.current, tower = towerRef.current;
    if (rim) { rim.visible = a > 0; rim.position.y = (1 - rimK) * -0.32 + (done ? 0 : Math.max(0, 0.35 - a) * 0.4); rim.scale.set(1, Math.max(0.01, rimK), 1); }
    if (depot) { depot.visible = yardK > 0; depot.position.y = done ? 0 : (1 - easeBounce(yardK)) * 1.1; }
    if (tower) { tower.visible = towerK > 0.002; const k = Math.max(0.001, towerK); tower.scale.set(1, k, 1); tower.position.y = (1 - k) * 0.16; }
    const bore = done ? 1 : easeOut((a - 0.35) / 1.05);
    const open = done ? 1 : easeOut((a - 0.32) / 0.6);
    const flash = done ? 0 : a > 0.4 ? Math.exp(-(a - 0.4) * 3.0) * clamp01((a - 0.4) / 0.08) : 0;
    const glow = 0.55 + 0.9 * n;
    const u = fx.u;
    u.uGlow.value = glow; u.uPulse.value = reduced ? 1 : 0.92 + 0.08 * Math.sin(t * 2.1); u.uShaft.value = (0.55 + 0.75 * n) * open; u.uT.value = t;
    const s = fx.shaft.u; s.uT.value = t; s.uBore.value = bore; s.uOpen.value = open; s.uFlash.value = flash * 0.6; s.uGlow.value = 0.74 + 0.7 * n + flash * 0.3;
    const g = fx.ground.u;
    const ringT = (a - 0.3) / 0.9;
    g.uGlow.value = (0.12 + 0.6 * n) * open; g.uRing.value = 0.3 + ringT * 1.15; g.uRingA.value = ringT > 0 && ringT < 1 ? (1 - ringT) * 0.9 : 0; g.uFlash.value = flash * 0.5;
    const pu = fx.points.u; pu.uT.value = t; pu.uAge.value = done ? 99 : a; pu.uNight.value = n; pu.uPx.value = size.height * dpr; pu.uSteam.value = 1; pu.uLights.value = topped ? 1 : 0;
    if (!full) return;
    const c = fx.column.u; c.uT.value = t; c.uAmt.value = (0.35 + 0.9 * n) * clamp01(bore * 1.2); c.uFlash.value = flash * 0.28; c.uGrow.value = clamp01(0.15 + flash * 3 + bore);
    if (colRef.current) colRef.current.visible = a > 0.35;
    const gm = gearsRef.current;
    if (gm) {
      gm.visible = topped;
      const spin = reduced ? 0 : t;
      for (let i = 0; i < sc.gearList.length; i++) {
        const gr = sc.gearList[i];
        _q.setFromAxisAngle(AX_Y, gr.yaw); _q2.setFromAxisAngle(AX_Z, gr.phase + spin * gr.speed * drillK2(a, done)); _q.multiply(_q2);
        gm.setMatrixAt(i, _m.compose(_p.set(gr.x, gr.y, gr.z), _q, _s.set(gr.r, gr.r, gr.r)));
      }
      gm.instanceMatrix.needsUpdate = true;
    }
    const fm = fansRef.current;
    if (fm) {
      fm.visible = yardK >= 1 || done;
      for (let i = 0; i < sc.fanList.length; i++) {
        const f = sc.fanList[i];
        _q.setFromAxisAngle(AX_Y, f.phase + (reduced ? 0 : t * f.speed));
        fm.setMatrixAt(i, _m.compose(_p.set(f.x, f.y, f.z), _q, _s.set(f.r, f.r, f.r)));
      }
      fm.instanceMatrix.needsUpdate = true;
    }
    const dr = drillRef.current;
    if (dr) {
      dr.visible = a > 2.6;
      const ease = easeOut(drillK);
      dr.position.y = (1 - ease) * 0.7 + (reduced ? 0 : Math.sin(t * 0.35) * 0.03 - 0.02);
      dr.rotation.y = reduced ? 0.7 : t * (2 + 16 * ease * ease);
    }
    const cv = convoyRef.current;
    if (cv) {
      cv.visible = done || a > 1.2;
      const k = done ? 1 : easeOut((a - 1.2) / 1.4);
      cv.rotation.y = (reduced ? 0.5 : t * 0.09) + (1 - k) * 2.4;
    }
  });

  const rimMat = full ? fx.rimMat : fx.rig;
  return (
    <group position={[0, p.top, 0]} scale={R} rotation={[0, yaw, 0]}>
      <mesh ref={rimRef} geometry={sc.rim} material={rimMat} />
      <mesh ref={depotRef} geometry={sc.depot} material={fx.rig} />
      <mesh ref={towerRef} geometry={sc.tower} material={fx.rig} />
      <mesh geometry={shaftGeo()} material={fx.shaft.mat} />
      {full && <mesh ref={colRef} geometry={colGeo()} material={fx.column.mat} renderOrder={2} />}
      <mesh geometry={groundGeo()} material={fx.ground.mat} renderOrder={1} />
      <points geometry={pts} material={fx.points.mat} renderOrder={3} frustumCulled={false} />
      {full && sc.gears && sc.gearList.length > 0 && <instancedMesh ref={gearsRef} args={[sc.gears, fx.gearMat, sc.gearList.length]} frustumCulled={false} />}
      {full && sc.fans && sc.fanList.length > 0 && <instancedMesh ref={fansRef} args={[sc.fans, fx.fanMat, sc.fanList.length]} frustumCulled={false} />}
      {full && sc.drill && <mesh ref={drillRef} geometry={sc.drill} material={fx.drillMat} frustumCulled={false} />}
      {full && sc.convoy && <mesh ref={convoyRef} geometry={sc.convoy} material={fx.convoyMat} frustumCulled={false} />}
    </group>
  );
}

let COL: THREE.BufferGeometry | null = null, GRD: THREE.BufferGeometry | null = null;
const colGeo = () => COL ??= columnGeometry();
const groundGeo = () => GRD ??= groundFxGeometry();
/** gears speed up as the drill does during the build-in */
function drillK2(a: number, done: boolean) { return done ? 1 : 0.15 + 0.85 * clamp01((a - 2.8) / 0.8); }
void TOWER_TOP;
