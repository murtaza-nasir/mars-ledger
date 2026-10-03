// Industrial Center: a heavy-industry complex. Three striped smokestacks with glowing rims and drifting smoke
// plumes, two furnaces whose doors glow orange and spit sparks, tanks, pipe runs, a sawtooth-roofed hall and
// owner-coloured lights. Build-in: the stacks extend upward one after another and each ignites with a puff.
import {useFrame, useThree} from '@react-three/fiber';
import {useEffect, useMemo} from 'react';
import * as THREE from 'three';
import {PLAYER_HEX} from '../../../../../shared/game';
import {seeded, world} from '../tiles3d';
import type {ModelMeta, ModelProps} from './contract';
import {Builder, G, clamp01, easeOutBack, easeOutCubic, hash, lampPatch, makeGlow, ramp, riseMaterial, setCol, setGlowScale, smooth, timeU, triCount} from './MineKit';

export const meta: ModelMeta = {name: 'Industrial Center', tileTypes: [6], kind: 'special', buildSeconds: 2.2};

const STACKS: Array<{x: number; z: number; h: number; r0: number; r1: number}> = [
  {x: -0.5, z: -0.4, h: 1.25, r0: 0.1, r1: 0.062},
  {x: -0.2, z: -0.58, h: 1.05, r0: 0.085, r1: 0.052},
  {x: 0.12, z: -0.52, h: 0.9, r0: 0.08, r1: 0.05},
];
const F1 = {x: 0.5, z: -0.28}, F2 = {x: 0.5, z: 0.1};
const WIND = [0.22, 0.05];

const built = new Map<number, {body: THREE.BufferGeometry; lit: THREE.BufferGeometry; tris: number}>();
function build(owner: number) {
  let b = built.get(owner);
  if (b) return b;
  const B = new Builder(), L = new Builder();
  // group 0: slab, hall, tanks
  B.grp = 0; L.grp = 0;
  B.add(G.cyl(1, 6), 0, 0.015, 0, 0x5a5650, {sx: 0.9, sy: 0.03, sz: 0.9, ao: [1, 1]});
  B.box(-0.3, 0.03, -0.27, 0.58, 0.19, 0.3, 0x6c7178);
  for (let i = 0; i < 3; i++) {
    B.add(G.box(), -0.2 + i * 0.19, 0.27, -0.12, 0x4a4f56, {sx: 0.19, sy: 0.012, sz: 0.34, rz: 0.0, rx: 0.32, ao: [0.9, 1]});
    B.box(-0.295 + i * 0.19, 0.22, -0.26, 0.012, 0.075, 0.3, 0x4a4f56);
  }
  L.box(-0.3, 0.226, 0.034, 0.58, 0.012, 0.012, owner);
  for (let i = 0; i < 6; i++) L.box(-0.27 + i * 0.095, 0.09, 0.032, 0.05, 0.045, 0.006, i % 4 === 2 ? 0x5a4a30 : 0xffc86a);
  // tanks
  B.cyl(-0.62, 0.03, 0.2, 0.12, 0.24, 0xdad6cc, 1, 14); B.add(G.sph(), -0.62, 0.27, 0.2, 0xdad6cc, {sx: 0.12, sy: 0.05, sz: 0.12});
  B.cyl(-0.62, 0.03, -0.06, 0.1, 0.19, 0xcfd3d6, 1, 14); B.add(G.sph(), -0.62, 0.22, -0.06, 0xcfd3d6, {sx: 0.1, sy: 0.045, sz: 0.1});
  for (const [lx, lz] of [[-0.43, 0.3], [-0.27, 0.3], [-0.43, 0.46], [-0.27, 0.46]]) B.cyl(lx, 0.03, lz, 0.012, 0.1, 0x3a3d42, 1, 5);
  B.add(G.sph(), -0.35, 0.24, 0.38, 0xc5502a, {sx: 0.13, sy: 0.13, sz: 0.13, ao: [0.6, 1]});
  B.box(-0.33, 0.03, 0.57, 0.1, 0.04, 0.06, 0xb8863a); B.box(-0.1, 0.03, 0.56, 0.08, 0.05, 0.07, 0x4a6a8a); B.box(0.1, 0.03, 0.58, 0.07, 0.035, 0.05, 0xb8863a);
  // pipes (round) from tanks to the hall and on to the furnaces
  B.tube(-0.62, 0.2, 0.2, -0.45, 0.12, -0.05, 0.02, 0xc65a2a); B.tube(-0.62, 0.17, -0.06, -0.3, 0.12, -0.14, 0.018, 0xb0b4ba);
  B.tube(0.28, 0.12, -0.14, 0.42, 0.12, -0.14, 0.022, 0xc65a2a); B.tube(0.28, 0.15, -0.2, 0.4, 0.15, -0.2, 0.016, 0xb0b4ba);
  // pipe rack along the hall front out to the furnaces, with three round pipes on posts
  B.grp = 4; L.grp = 4;
  for (let i = 0; i < 8; i++) { const x = -0.28 + i * 0.1; B.box(x - 0.006, 0.03, 0.2, 0.012, 0.09, 0.012, 0x3a3d42); B.box(x - 0.03, 0.12, 0.192, 0.06, 0.008, 0.028, 0x3a3d42); }
  B.tube(-0.3, 0.14, 0.2, 0.46, 0.14, 0.2, 0.014, 0xc65a2a); B.tube(-0.3, 0.14, 0.208, 0.46, 0.14, 0.208, 0.011, 0xb0b4ba); B.tube(-0.3, 0.14, 0.192, 0.46, 0.14, 0.192, 0.011, 0x4a7aa0);
  B.tube(0.46, 0.14, 0.2, 0.5, 0.2, 0.1, 0.013, 0xc65a2a); B.tube(0.14, 0.14, 0.2, 0.14, 0.14, 0.06, 0.012, 0xb0b4ba);
  // grated walkway on the hall front and a raised catwalk to the furnaces
  B.grp = 0; L.grp = 0;
  for (let i = 0; i < 20; i++) B.box(-0.3 + i * 0.03, 0.045, 0.07, 0.016, 0.006, 0.07, 0x20232a);
  B.box(-0.3, 0.05, 0.068, 0.6, 0.006, 0.006, 0x6a6f78); B.box(-0.3, 0.05, 0.138, 0.6, 0.006, 0.006, 0x6a6f78);
  for (let i = 0; i < 7; i++) B.box(-0.3 + i * 0.1, 0.03, 0.065, 0.008, 0.02, 0.008, 0x6a6f78);
  for (let i = 0; i < 12; i++) B.box(0.62, 0.045, -0.26 + i * 0.045, 0.07, 0.006, 0.028, 0x20232a);
  B.box(0.61, 0.05, -0.27, 0.006, 0.006, 0.52, 0x6a6f78); B.box(0.69, 0.05, -0.27, 0.006, 0.006, 0.52, 0x6a6f78);
  // rail spur with an ore car
  for (let i = 0; i < 16; i++) B.box(-0.18 + i * 0.055, 0.03, 0.5, 0.02, 0.008, 0.1, 0x4a3a2a);
  B.box(-0.2, 0.038, 0.52, 0.86, 0.008, 0.01, 0x8a8f98); B.box(-0.2, 0.038, 0.58, 0.86, 0.008, 0.01, 0x8a8f98);
  B.box(0.3, 0.05, 0.505, 0.2, 0.07, 0.09, 0x6a3a2a); B.box(0.31, 0.12, 0.51, 0.18, 0.02, 0.08, 0x3a2418);
  for (const wx of [0.33, 0.45]) for (const wz of [0.5, 0.58]) B.add(G.cyl(1, 8), wx, 0.048, wz, 0x1c1d1f, {rx: Math.PI / 2, sx: 0.02, sy: 0.012, sz: 0.02});
  B.box(0.66, 0.03, 0.5, 0.03, 0.05, 0.1, 0xb8863a);
  // cooling pond with a slag channel from the furnace
  B.add(G.cyl(1, 14), 0.2, 0.034, 0.34, 0x2d2b2a, {sx: 0.19, sy: 0.014, sz: 0.12, ao: [1, 1]});
  L.add(G.cyl(1, 14), 0.2, 0.043, 0.34, 0xff6a1a, {sx: 0.16, sy: 0.004, sz: 0.095, ao: [1, 1]});
  L.add(G.cyl(1, 10), 0.14, 0.044, 0.33, 0xffb050, {sx: 0.06, sy: 0.004, sz: 0.035, ao: [1, 1]});
  L.box(0.34, 0.036, 0.255, 0.18, 0.004, 0.016, 0xff7a1a, {ry: -0.4}); L.box(0.44, 0.036, 0.2, 0.08, 0.004, 0.016, 0xff8a22, {ry: -0.9});
  // ground clutter: barrels, crates, lamp posts, a control shed
  [[-0.1, 0.4, 0xc65a2a], [-0.06, 0.42, 0x4a7aa0], [-0.02, 0.4, 0xc65a2a], [0.0, 0.44, 0xb8863a], [-0.14, 0.45, 0x4a7aa0], [0.62, 0.36, 0xc65a2a], [0.66, 0.4, 0xc65a2a], [0.58, 0.42, 0x4a7aa0]].forEach(([x, z, c]) => B.cyl(x, 0.03, z, 0.018, 0.04, c as number, 1, 8));
  [[-0.5, 0.52], [-0.58, 0.5], [0.76, 0.2], [-0.78, 0.0], [-0.7, -0.3]].forEach(([x, z], i) => B.box(x, 0.03, z, 0.06, 0.04 + (i % 2) * 0.03, 0.05, i % 2 ? 0xb8863a : 0x4a6a8a));
  B.box(0.7, 0.03, 0.04, 0.12, 0.09, 0.09, 0x6c7178); B.box(0.69, 0.12, 0.035, 0.14, 0.008, 0.1, 0x3a3d42); L.box(0.72, 0.07, 0.133, 0.07, 0.03, 0.004, 0xffc86a);
  [[-0.7, 0.3], [0.36, 0.14], [-0.2, 0.08], [0.1, -0.7]].forEach(([x, z]) => { B.cyl(x, 0.03, z, 0.006, 0.17, 0x3a3d42, 1, 5); L.box(x - 0.016, 0.2, z - 0.01, 0.032, 0.012, 0.02, 0xffe2a0); });
  // more pipes: a vertical riser beside the hall and a long run at the back
  B.tube(-0.3, 0.2, -0.3, 0.3, 0.2, -0.3, 0.016, 0x9aa0a8); B.tube(-0.28, 0.03, -0.3, -0.28, 0.2, -0.3, 0.014, 0xc65a2a); B.tube(0.28, 0.03, -0.3, 0.28, 0.2, -0.3, 0.014, 0xc65a2a);
  // groups 1..3: stacks (stripes + the glowing rim and owner ring in the lit mesh)
  STACKS.forEach((s, i) => {
    B.grp = L.grp = 1 + i;
    const n = 6;
    B.cyl(s.x, 0, s.z, s.r0 * 1.5, 0.04, 0x4a4540, 1, 12);
    for (let k = 0; k < n; k++) {
      const y0 = (k / n) * s.h, y1 = ((k + 1) / n) * s.h, ra = s.r0 + (s.r1 - s.r0) * (y0 / s.h), rb = s.r0 + (s.r1 - s.r0) * (y1 / s.h);
      B.cyl(s.x, y0, s.z, ra, y1 - y0, k % 2 ? 0xd9d2c4 : 0x9a3c30, rb / ra, 12);
    }
    B.cyl(s.x, s.h - 0.01, s.z, s.r1 * 1.12, 0.03, 0x2d2b2a, 0.9, 12);
    L.cyl(s.x, s.h + 0.018, s.z, s.r1 * 0.88, 0.006, 0xff8a2a, 1, 12);
    L.cyl(s.x, s.h * 0.78, s.z, (s.r0 + (s.r1 - s.r0) * 0.78) * 1.08, 0.022, owner, 1, 12);
    B.bar(s.x + s.r0, 0.04, s.z + 0.01, s.x + s.r1 * 1.1, s.h - 0.05, s.z + 0.01, 0.008, 0x2d2b2a);
  });
  // group 4: furnaces and their stack pipes
  B.grp = L.grp = 4;
  B.cyl(F1.x, 0.03, F1.z, 0.15, 0.42, 0x4a3f3a, 0.72, 12); B.cyl(F1.x, 0.45, F1.z, 0.1, 0.06, 0x2d2b2a, 0.6, 12);
  B.cyl(F2.x, 0.03, F2.z, 0.11, 0.3, 0x544842, 0.75, 12);
  B.add(G.box(), F1.x, 0.09, F1.z + 0.145, 0x2d2b2a, {sx: 0.11, sy: 0.12, sz: 0.03});
  B.add(G.box(), F2.x, 0.07, F2.z + 0.105, 0x2d2b2a, {sx: 0.085, sy: 0.1, sz: 0.03});
  L.box(F1.x - 0.04, 0.04, F1.z + 0.157, 0.08, 0.085, 0.006, 0xff7a1a);
  L.box(F2.x - 0.03, 0.03, F2.z + 0.117, 0.06, 0.07, 0.006, 0xff6a12);
  for (let k = 0; k < 4; k++) L.box(F1.x + Math.sin(k * 1.6) * 0.14 - 0.006, 0.18 + k * 0.05, F1.z + Math.cos(k * 1.6) * 0.14 - 0.006, 0.012, 0.03, 0.012, 0xff8a2a);
  B.tube(F1.x, 0.5, F1.z, 0.12, 0.58, -0.5, 0.02, 0xb0b4ba); B.tube(F2.x, 0.3, F2.z, F1.x, 0.3, F1.z + 0.1, 0.018, 0xc65a2a);
  const body = B.build(), lit = L.build();
  b = {body, lit, tris: triCount(body) + triCount(lit)};
  built.set(owner, b);
  return b;
}

const SM = 0, NS = 16, SP = 48, NSP = 24, PF = 72, NPF = 6, TG = 90, OG = 93, FG = 98, FPOOL = 100, N = 110;
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
function setMix(arr: Float32Array, i: number, a: number, b: number, t: number, k: number) {
  const ar = ((a >> 16) & 255) / 255, ag = ((a >> 8) & 255) / 255, ab = (a & 255) / 255, br = ((b >> 16) & 255) / 255, bg = ((b >> 8) & 255) / 255, bb = (b & 255) / 255;
  arr[i * 3] = mix(ar, br, t) * k; arr[i * 3 + 1] = mix(ag, bg, t) * k; arr[i * 3 + 2] = mix(ab, bb, t) * k;
}

export default function IndustrialCenter(p: ModelProps) {
  const owner = p.color && PLAYER_HEX[p.color] ? parseInt(PLAYER_HEX[p.color].slice(1), 16) : 0xffc86a;
  const mirror = useMemo(() => (seeded(p.id)() < 0.5 ? -1 : 1), [p.id]);
  const geo = useMemo(() => build(owner), [owner]);
  const lampP = useMemo(() => lampPatch(9), []);
  const bodyM = useMemo(() => riseMaterial(new THREE.MeshStandardMaterial({vertexColors: true, roughness: 0.8, metalness: 0.25}), 'ind-body', lampP.extra), [lampP]);
  const litM = useMemo(() => riseMaterial(new THREE.MeshBasicMaterial({vertexColors: true}), 'ind-lit', undefined, bodyM.rise), [bodyM]);
  const rise = bodyM.rise;
  const glow = useMemo(() => makeGlow(N), []);
  const {camera} = useThree();
  useEffect(() => () => { bodyM.mat.dispose(); litM.mat.dispose(); glow.points.geometry.dispose(); }, [bodyM, litM, glow]);

  useFrame((state) => {
    const t = world.t, night = p.night, a = world.reduced ? 99 : p.age();
    timeU.value = t;
    setGlowScale(state.size.height * state.gl.getPixelRatio(), (camera as THREE.PerspectiveCamera).fov ?? 40);
    rise[0] = easeOutBack(ramp(a, 0, 0.6));
    rise[4] = easeOutBack(ramp(a, 0.3, 0.7));
    const gl = glow;
    lampP.uLit.value = night * 0.7 * (0.4 + 0.6 * ramp(a, 1.2, 0.8));
    const L = lampP.lamps;
    L.set([F1.x, 0.15, F1.z + 0.2, 0.8, F2.x, 0.1, F2.z + 0.2, 0.7, -0.05, 0.15, 0.2, 0.75, -0.5, 0.2, 0.25, 0.5, STACKS[0].x, 0.1, STACKS[0].z + 0.1, 0.5, STACKS[1].x, 0.1, STACKS[1].z + 0.1, 0.45, STACKS[2].x, 0.1, STACKS[2].z + 0.1, 0.45, 0.2, 0.08, 0.34, 0.4, 0.4, 0.1, 0.5, 0.5]);
    const flick = 0.85 + 0.15 * Math.sin(t * 9.3) * Math.sin(t * 4.1 + 1);
    for (let s = 0; s < 3; s++) {
      const st = STACKS[s], t0 = 0.12 + s * 0.3, len = 0.85;
      const r = world.reduced ? 1 : easeOutCubic(ramp(a, t0, len));
      rise[1 + s] = r;
      const ign = a - (t0 + len); // seconds since this stack ignited
      const lit = world.reduced ? 1 : smooth(0, 0.5, ign);
      const topY = st.h * r;
      // smoke plume
      for (let k = 0; k < NS; k++) {
        const i = SM + s * NS + k, o = i * 3;
        const life = (t * 0.16 + k / NS + hash(s, 3)) % 1;
        const rd = hash(k + s * 20, 5), sw = Math.sin(t * 0.7 + k * 1.9 + s * 3) * 0.04 * life;
        gl.pos[o] = st.x + WIND[0] * life * (1 + rd * 0.5) + sw; gl.pos[o + 1] = topY + 0.03 + life * 0.85; gl.pos[o + 2] = st.z + WIND[1] * life + hash(k + s, 6) * 0.03;
        gl.kind[i] = 0;
        setMix(gl.col, i, 0xffa24a, night > 0.5 ? 0x4a4850 : 0xb4aea6, smooth(0, 0.28 + 0.4 * night, life) * (1 - 0.15 * night), 1 + 0.5 * night * (1 - life));
        gl.size[i] = 0.07 + life * 0.28;
        gl.alpha[i] = 0.55 * Math.sin(Math.PI * Math.pow(life, 0.7)) * lit * (world.reduced ? 0.6 : 1) * (0.7 + 0.3 * rd);
      }
      // stack-top glow
      const tg = TG + s;
      gl.pos[tg * 3] = st.x; gl.pos[tg * 3 + 1] = topY + 0.03; gl.pos[tg * 3 + 2] = st.z;
      setCol(gl.col, tg, 0xff8a2a); gl.kind[tg] = 1; gl.size[tg] = 0.3 * (0.9 + 0.1 * flick); gl.alpha[tg] = (0.35 + 0.5 * night) * lit * flick;
      // owner glow on the ring
      const og = OG + s, ry = st.h * 0.78 * r;
      gl.pos[og * 3] = st.x; gl.pos[og * 3 + 1] = ry; gl.pos[og * 3 + 2] = st.z + st.r0 * 0.9;
      setCol(gl.col, og, owner); gl.kind[og] = 1; gl.size[og] = 0.2; gl.alpha[og] = (0.3 + 0.5 * night) * clamp01(r * 2);
      // ignition puff: a burst of bright particles that fades
      for (let k = 0; k < NPF; k++) {
        const i = PF + s * NPF + k, o = i * 3, u = clamp01(ign / 0.8);
        const ang = (k / NPF) * 6.283 + s, rad = u * 0.22;
        gl.pos[o] = st.x + Math.cos(ang) * rad; gl.pos[o + 1] = topY + 0.04 + u * 0.18; gl.pos[o + 2] = st.z + Math.sin(ang) * rad;
        setCol(gl.col, i, 0xffb060); gl.kind[i] = 1; gl.size[i] = 0.12 + u * 0.16; gl.alpha[i] = ign > 0 && ign < 0.8 ? 0.8 * (1 - u) : 0;
      }
    }
    // owner glow on the roof edge
    for (let k = 0; k < 2; k++) {
      const i = OG + 3 + k;
      gl.pos[i * 3] = -0.3 + k * 0.58; gl.pos[i * 3 + 1] = 0.26 * rise[0]; gl.pos[i * 3 + 2] = 0.03;
      setCol(gl.col, i, owner); gl.kind[i] = 1; gl.size[i] = 0.2; gl.alpha[i] = (0.35 + 0.55 * night) * (0.75 + 0.25 * Math.sin(t * 2.4 + k * 2)) * clamp01(rise[0]);
    }
    // furnace glow
    for (let k = 0; k < 2; k++) {
      const i = FG + k, f = k ? F2 : F1;
      gl.pos[i * 3] = f.x; gl.pos[i * 3 + 1] = (k ? 0.07 : 0.1) * rise[4]; gl.pos[i * 3 + 2] = f.z + (k ? 0.14 : 0.19);
      setCol(gl.col, i, 0xff6a1a); gl.kind[i] = 1; gl.size[i] = k ? 0.34 : 0.42; gl.alpha[i] = (0.4 + 0.5 * night) * flick * clamp01(rise[4] * 1.2);
    }
    // sparks from the furnace doors
    for (let k = 0; k < NSP; k++) {
      const i = SP + k, o = i * 3, f = k % 2 ? F2 : F1;
      const per = 3 + hash(k, 41) * 3, ph = (t + hash(k, 42) * per) % per, life = ph / 0.9; // flies for 0.9 s
      const on = world.reduced ? 0 : life < 1 ? 1 : 0;
      const vx = 0.12 + hash(k, 43) * 0.25, vy = 0.3 + hash(k, 44) * 0.35, vz = (hash(k, 45) - 0.3) * 0.3;
      gl.pos[o] = f.x + vx * ph * (hash(k, 46) < 0.5 ? 1 : -0.6); gl.pos[o + 1] = 0.12 + vy * ph - 0.5 * 0.9 * ph * ph; gl.pos[o + 2] = f.z + 0.17 + vz * ph;
      setCol(gl.col, i, 0xffc070); gl.kind[i] = 2; gl.size[i] = 0.05; gl.alpha[i] = on * (1 - life) * clamp01(rise[4]);
    }
    // warm pools on the ground (furnaces, stack bases) and the cooling pond's glow
    const pools: Array<[number, number, number, number]> = [[F1.x, 0.03, F1.z + 0.22, 0.8], [F2.x, 0.03, F2.z + 0.2, 0.65], [STACKS[0].x, 0.04, STACKS[0].z, 0.55], [STACKS[1].x, 0.04, STACKS[1].z, 0.5], [STACKS[2].x, 0.04, STACKS[2].z, 0.5], [0.2, 0.06, 0.34, 0.6]];
    for (let k = 0; k < 6; k++) {
      const i = FPOOL + k, o = i * 3;
      gl.pos[o] = pools[k][0]; gl.pos[o + 1] = pools[k][1]; gl.pos[o + 2] = pools[k][2];
      setCol(gl.col, i, k === 5 ? 0xff7a2a : 0xff9a50); gl.kind[i] = 1; gl.size[i] = pools[k][3];
      gl.alpha[i] = (k === 5 ? 0.3 : 0.2) * (0.15 + 0.85 * night) * flick * clamp01(rise[k < 2 ? 4 : k < 5 ? k - 1 : 0] * 1.2);
    }
    for (let k = 0; k < 4; k++) {
      const i = FPOOL + 6 + k, o = i * 3;
      gl.pos[o] = 0.1 + k * 0.08 + Math.sin(t * 0.8 + k) * 0.03; gl.pos[o + 1] = 0.06; gl.pos[o + 2] = 0.34 + Math.cos(t * 0.6 + k * 2) * 0.04;
      setCol(gl.col, i, 0xffa040); gl.kind[i] = 1; gl.size[i] = 0.2; gl.alpha[i] = (0.25 + 0.3 * night) * (0.7 + 0.3 * Math.sin(t * 2 + k * 1.7)) * clamp01(rise[0]);
    }
    gl.dirty();
  });

  return (
    <group position={[0, p.top, 0]} scale={[p.radius * mirror, p.radius, p.radius]}>
      <mesh geometry={geo.body} material={bodyM.mat} />
      <mesh geometry={geo.lit} material={litM.mat} />
      <primitive object={glow.points} />
    </group>
  );
}
