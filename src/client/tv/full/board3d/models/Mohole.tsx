// Mohole Area: a vast engineered bore into the Martian crust. A terraced rim with a glowing lip, a shaft that reads as
// kilometres deep (a ray-traced fake: magma veins, owner-coloured guide lights, a molten floor), a gantry crane with a
// drill head, tanks, a flare stack, a heat-shimmer column, steam plumes, rising embers and blinking warning lights.
// Build-in (~2 s): the rim stamps down with a shockwave, the shaft bores open in a flash and a vapour blast, and the
// gantry telescopes up. Four draw calls of geometry plus the ground halo and the points: six in all.
import {useFrame, useThree} from '@react-three/fiber';
import {useEffect, useMemo, useRef} from 'react';
import * as THREE from 'three';
import {PLAYER_HEX} from '../../../../../shared/game';
import {seeded, world} from '../tiles3d';
import type {ModelMeta, ModelProps} from './contract';
import {makeRigMaterial, Parts} from './MoholeBuild';
import {columnGeometry, columnMaterial, groundFxGeometry, groundFxMaterial, pointsGeometry, pointsMaterial, SHAFT_RADIUS, SHAFT_Y, shaftMaterial, type MoleLight} from './MoholeFX';

export const meta: ModelMeta = {name: 'Mohole Area', tileTypes: [10], kind: 'special', buildSeconds: 2.2};

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const easeOut = (x: number) => 1 - Math.pow(1 - clamp01(x), 3);
const easeBack = (x: number) => { const k = clamp01(x) - 1; return 1 + 2.6 * k * k * k + 1.6 * k * k; };

// ---- shared geometry (built once) ---------------------------------------------------------------------------------
const LIGHTS: MoleLight[] = [
  [-0.55, 0.78, 0], [0.55, 0.78, 0], [0.55, 0.47, -0.45], // beam ends, stack
  [0.55, 0.31, 0.56], [-0.55, 0.31, 0.56], [-0.55, 0.31, -0.56], [0.0, 0.33, -0.78], // masts
];

let SHARED: {rim: THREE.BufferGeometry; rig: THREE.BufferGeometry; shaft: THREE.BufferGeometry; column: THREE.BufferGeometry; ground: THREE.BufferGeometry} | null = null;
function shared() {
  if (SHARED) return SHARED;
  // terraced rim: lathe segments (r0,y0 -> r1,y1), colour, glow
  const rim = new Parts();
  const seg: Array<[number, number, number, number, string, number]> = [
    [0.85, 0.0, 0.78, 0.09, '#6a3a2a', 0], [0.78, 0.09, 0.70, 0.14, '#7b4733', 0], [0.70, 0.14, 0.62, 0.14, '#3a3d45', 0],
    [0.62, 0.14, 0.61, 0.095, '#4e2f20', 0], [0.61, 0.095, 0.53, 0.095, '#8a8c93', 0], [0.53, 0.095, 0.52, 0.055, '#4e2f20', 0],
    [0.52, 0.055, 0.45, 0.055, '#5c5f67', 0], [0.45, 0.055, 0.44, 0.025, '#3a2218', 0], [0.44, 0.025, 0.392, 0.025, '#ff7a2a', 1.4],
  ];
  for (const [r0, y0, r1, y1, c, gl] of seg) {
    const g = new THREE.LatheGeometry([new THREE.Vector2(r0, y0), new THREE.Vector2(r1, y1)], 56);
    rim.geo(g, c, {glow: gl, vary: 0.18}); g.dispose();
  }
  // buttresses on the first terrace and lamps on the crest
  const rnd = seeded('mohole-shape', 1);
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2;
    rim.box(Math.cos(a) * 0.575, 0.11, Math.sin(a) * 0.575, 0.075, 0.03, 0.022, '#a2a5ad', {ry: -a});
  }
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + 0.13;
    rim.box(Math.cos(a) * 0.66, 0.165, Math.sin(a) * 0.66, 0.035, 0.035, 0.035, '#ffd9a0', {glow: 1, owner: i % 3 === 0 ? 1 : 0, ry: -a});
  }
  // rubble boulders on the outer slope
  for (let i = 0; i < 16; i++) {
    const a = rnd() * 6.283, r = 0.74 + rnd() * 0.06, s = 0.025 + rnd() * 0.035;
    rim.box(Math.cos(a) * r, 0.06 + rnd() * 0.02, Math.sin(a) * r, s * 1.4, s, s * 1.2, '#5a3123', {ry: rnd() * 3});
  }

  const rig = new Parts();
  const metal = '#b4b7bf', dark = '#2c2f36', yel = '#e8b923';
  // walkway rail and posts
  const rail = new THREE.TorusGeometry(0.66, 0.008, 5, 56); rail.rotateX(Math.PI / 2); rig.geo(rail, '#d0d2d8', {y: 0.205}); rail.dispose();
  for (let i = 0; i < 28; i++) { const a = (i / 28) * 6.283; rig.box(Math.cos(a) * 0.66, 0.175, Math.sin(a) * 0.66, 0.012, 0.06, 0.012, yel); }
  // gantry: two A-frames and a bridge beam
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) rig.strut(sx * 0.72, 0.12, sz * 0.15, sx * 0.55, 0.74, sz * 0.045, 0.034, metal);
    for (let k = 0; k < 4; k++) {
      const t0 = k / 4, t1 = (k + 1) / 4;
      const xa = sx * (0.72 - 0.17 * t0), ya = 0.12 + 0.62 * t0, za = 0.15 - 0.105 * t0;
      const xb = sx * (0.72 - 0.17 * t1), yb = 0.12 + 0.62 * t1, zb = 0.15 - 0.105 * t1;
      rig.strut(xa, ya, -za, xb, yb, zb, 0.016, '#7c8088');
      rig.strut(xa, ya, za, xb, yb, -zb, 0.016, '#7c8088');
      rig.strut(xa, ya, -za, xa, ya, za, 0.014, '#7c8088');
    }
    rig.box(sx * 0.55, 0.76, 0, 0.14, 0.1, 0.16, '#40444c');
    rig.box(sx * 0.55, 0.76, 0.083, 0.11, 0.07, 0.006, '#fff', {owner: 1, glow: 0.7});
  }
  rig.box(0, 0.78, 0, 1.12, 0.07, 0.11, '#9ea1a9');
  rig.box(0, 0.78, 0.058, 1.0, 0.032, 0.006, '#fff', {owner: 1, glow: 0.6});
  rig.box(0, 0.78, -0.058, 1.0, 0.032, 0.006, '#fff', {owner: 1, glow: 0.6});
  rig.box(0, 0.835, 0, 1.1, 0.012, 0.012, yel);
  // trolley, cable and the drill head hanging in the bore
  rig.box(0.02, 0.715, 0, 0.14, 0.06, 0.15, '#3d4047');
  rig.cyl(0.02, 0.52, 0, 0.007, 0.007, 0.3, '#16171a');
  rig.cyl(0.02, 0.36, 0, 0.05, 0.05, 0.1, '#6c7078');
  rig.cyl(0.02, 0.29, 0, 0.032, 0.032, 0.07, '#ff9a3a', {glow: 1.3});
  rig.cyl(0.02, 0.22, 0, 0.0, 0.032, 0.08, '#40434b', {seg: 8});
  // tanks and pipework behind the bore
  for (const [x, z, h] of [[-0.5, -0.44, 0.24], [-0.33, -0.56, 0.2], [-0.62, -0.2, 0.18]] as Array<[number, number, number]>) {
    rig.cyl(x, 0.1 + h / 2, z, 0.09, 0.09, h, '#cfd1d6', {seg: 14});
    rig.cyl(x, 0.1 + h * 0.55, z, 0.0935, 0.0935, 0.045, '#fff', {owner: 1, glow: 0.35, seg: 14});
    rig.cyl(x, 0.1 + h + 0.012, z, 0.07, 0.09, 0.025, '#868991', {seg: 14});
  }
  rig.strut(-0.5, 0.2, -0.44, -0.2, 0.17, -0.34, 0.022, '#6c7078');
  rig.strut(-0.33, 0.2, -0.56, -0.12, 0.17, -0.44, 0.022, '#6c7078');
  // flare stack with a lit crown
  rig.cyl(0.55, 0.3, -0.45, 0.026, 0.04, 0.4, '#5e6068');
  rig.cyl(0.55, 0.51, -0.45, 0.034, 0.026, 0.03, '#ff8a2a', {glow: 1.6});
  // control blocks with lit windows
  for (const [x, z, ry] of [[0.45, 0.52, -0.4], [0.6, 0.38, -0.6]] as Array<[number, number, number]>) {
    rig.box(x, 0.15, z, 0.2, 0.1, 0.12, dark, {ry});
    rig.box(x + Math.sin(ry) * -0.0, 0.17, z + 0.0, 0.14, 0.022, 0.125, '#ffd27a', {glow: 1.1, ry});
    rig.box(x, 0.205, z, 0.22, 0.012, 0.14, '#9a9da5', {ry});
  }
  // light masts
  for (const [x, , z] of LIGHTS.slice(3)) {
    rig.cyl(x, 0.2, z, 0.008, 0.012, 0.22, '#9a9da5');
    rig.box(x, 0.315, z, 0.04, 0.025, 0.04, '#fff', {owner: 1, glow: 1});
  }

  const shaft = new THREE.CircleGeometry(SHAFT_RADIUS, 40); shaft.rotateX(-Math.PI / 2); shaft.translate(0, SHAFT_Y, 0);
  SHARED = {rim: rim.build(), rig: rig.build(), shaft, column: columnGeometry(), ground: groundFxGeometry()};
  return SHARED;
}

// ---- the component -----------------------------------------------------------------------------------------------
export default function Mohole(p: ModelProps) {
  const R = p.radius;
  const sh = useMemo(shared, []);
  const ownerHex = PLAYER_HEX[p.color ?? 'red'] ?? '#ffffff';
  const yaw = useMemo(() => (seeded(p.id, 3)() - 0.5) * 0.7, [p.id]);
  const pts = useMemo(() => pointsGeometry(LIGHTS, 40, 36, seeded(p.id, 4)), [p.id]);
  const fx = useMemo(() => {
    const rim = makeRigMaterial(), rig = makeRigMaterial(), shaft = shaftMaterial(), column = columnMaterial(), ground = groundFxMaterial(), points = pointsMaterial();
    return {rim, rig, shaft, column, ground, points};
  }, []);
  useEffect(() => () => { pts.dispose(); fx.rim.mat.dispose(); fx.rig.mat.dispose(); fx.shaft.mat.dispose(); fx.column.mat.dispose(); fx.ground.mat.dispose(); fx.points.mat.dispose(); }, [pts, fx]);
  useEffect(() => {
    for (const u of [fx.rim.u.uOwner, fx.rig.u.uOwner, fx.shaft.u.uOwner, fx.column.u.uOwner, fx.points.u.uOwner]) u.value.set(ownerHex);
  }, [fx, ownerHex]);

  const rimRef = useRef<THREE.Mesh>(null);
  const rigRef = useRef<THREE.Mesh>(null);
  const colRef = useRef<THREE.Mesh>(null);
  const size = useThree((s) => s.size), dpr = useThree((s) => s.viewport.dpr);

  useFrame(() => {
    const reduced = world.reduced;
    const a = reduced ? 1e9 : p.age();
    const t = reduced ? 4.2 : world.t;
    const n = p.night;
    // placement timeline: stamp 0..0.3, shockwave from 0.3, bore 0.35..1.3, flash peak 0.55, gantry 0.7..1.8
    const drop = a < 0.3 ? 1 - (a / 0.3) ** 2 : 0;
    const settle = a >= 0.3 && a < 0.7 ? Math.exp(-(a - 0.3) * 9) * Math.sin((a - 0.3) * 30) * 0.06 : 0;
    const rim = rimRef.current, rig = rigRef.current, col = colRef.current;
    if (rim) { rim.position.y = drop * 0.7; rim.scale.set(1, 1 + settle - drop * 0.3, 1); rim.visible = a > 0.0; }
    const bore = a > 1e8 ? 1 : easeOut((a - 0.35) / 1.0);
    const open = a > 1e8 ? 1 : easeOut((a - 0.32) / 0.6);
    const flash = a > 1e8 ? 0 : a > 0.4 ? Math.exp(-(a - 0.4) * 3.0) * clamp01((a - 0.4) / 0.08) : 0;
    const glow = 0.55 + 0.75 * n;
    const pulse = reduced ? 1 : 0.9 + 0.1 * Math.sin(t * 2.1);
    if (rig) { const k = a > 1e8 ? 1 : Math.max(0.001, easeBack((a - 0.7) / 0.9)); rig.scale.set(1, k, 1); rig.visible = a > 0.7; }
    fx.rim.u.uGlow.value = glow * 1.1; fx.rig.u.uGlow.value = glow; fx.rim.u.uPulse.value = fx.rig.u.uPulse.value = pulse;
    const s = fx.shaft.u; s.uT.value = t; s.uBore.value = bore; s.uOpen.value = open; s.uFlash.value = flash * 0.6; s.uGlow.value = 0.72 + 0.55 * n + flash * 0.3;
    const c = fx.column.u; c.uT.value = t; c.uAmt.value = (0.35 + 0.9 * n) * clamp01(bore * 1.2); c.uFlash.value = flash * 0.28; c.uGrow.value = clamp01(0.15 + flash * 3 + bore);
    if (col) col.visible = a > 0.35;
    const g = fx.ground.u;
    const ringT = (a - 0.3) / 0.8;
    g.uGlow.value = (0.12 + 0.55 * n) * open; g.uRing.value = 0.3 + ringT * 1.1; g.uRingA.value = ringT > 0 && ringT < 1 ? (1 - ringT) * 0.9 : 0; g.uFlash.value = flash * 0.5;
    const pu = fx.points.u; pu.uT.value = t; pu.uAge.value = a > 1e8 ? 99 : a; pu.uNight.value = n; pu.uPx.value = size.height * dpr;
    pu.uSteam.value = 1;
  });

  return (
    <group position={[0, p.top, 0]} scale={R} rotation={[0, yaw, 0]}>
      <mesh ref={rimRef} geometry={sh.rim} material={fx.rim.mat} />
      <mesh ref={rigRef} geometry={sh.rig} material={fx.rig.mat} />
      <mesh geometry={sh.shaft} material={fx.shaft.mat} />
      <mesh ref={colRef} geometry={sh.column} material={fx.column.mat} renderOrder={2} />
      <mesh geometry={sh.ground} material={fx.ground.mat} renderOrder={1} />
      <points geometry={pts} material={fx.points.mat} renderOrder={3} frustumCulled={false} />
    </group>
  );
}
