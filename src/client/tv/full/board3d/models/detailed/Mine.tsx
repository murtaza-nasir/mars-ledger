// Detailed Mine (Mining Area / Mining Rights / steel and titanium bonus tiles): a deep stepped open pit with strata
// benches and a spiral haul road, three haul trucks carrying ore (headlights at night), an excavator digging, a lattice
// headframe with a turning sheave wheel, cables and a hoist cage, a conveyor into a crusher and processing plant,
// stockpiles tinted per variant (rusty iron for steel, glittering blue-silver for titanium), floodlights.
// Build-in: the pit carves itself out of a solid plateau, the plant and headframe rise, the excavator drops in, the
// trucks start rolling. detail='lite' keeps the same layout in <= 6 draw calls.
import {useFrame, useThree} from '@react-three/fiber';
import {useEffect, useMemo, useRef} from 'react';
import * as THREE from 'three';
import {PLAYER_HEX} from '../../../../../../shared/game';
import {seeded, world} from '../../tiles3d';
import type {ModelMeta, ModelProps} from '../contract';
import {G, clamp01, easeOutBack, easeOutCubic, hash, lampPatch, makeGlow, ramp, riseMaterial, setCol, setGlowScale, smooth, timeU} from '../MineKit';
import {C, PHI, VARIANTS, groundGeo, mineTextures, roadH, roadR, roadTh, terrainMaterial, variantOf} from './MineGround';
import {BELT_E, BELT_S, EXC, EXC_BOOM, EXC_STICK, FLOODS, HF, HF_H, PILES, STACK_E, STACK_S, WIND, buildParts, gy, wheelY, N_RL, type MineGeo} from './MineParts';

export const meta: ModelMeta = {set: 'detailed', name: 'Mine', tileTypes: [8, 9, 27, 28], kind: 'special', buildSeconds: 3.2};

const built = new Map<string, {geo: MineGeo; ground: THREE.BufferGeometry}>();
function build(vk: string, owner: number, rights: boolean, full: boolean) {
  const key = `${vk}|${owner}|${rights}|${full}`;
  let b = built.get(key);
  if (!b) { b = {geo: buildParts(VARIANTS[vk], owner, rights, full), ground: groundGeo(VARIANTS[vk], full)}; built.set(key, b); }
  const tc = (g: THREE.BufferGeometry) => Math.round((g.index ? g.index.count : g.attributes.position?.count ?? 0) / 3);
  (globalThis as unknown as {__detailedStats?: Record<string, unknown>}).__detailedStats = {...((globalThis as unknown as {__detailedStats?: Record<string, unknown>}).__detailedStats ?? {}), [`mine-${full ? 'full' : 'lite'}`]: {ground: tc(b.ground), body: tc(b.geo.body), lit: tc(b.geo.lit), truck: tc(b.geo.truck), load: tc(b.geo.load), wheel: tc(b.geo.wheel)}};
  return b;
}

const N_CHUNK = 34, N_TRUCK = 3, CYCLE = 21;
const dummy = new THREE.Object3D(); dummy.rotation.order = 'YXZ';
const GLN = {beacon: 1, flood: 4, floodPool: 4, head: 6, beam: 12, spark: 8, pileSpark: 12, dust: 24, buildDust: 24, roadLamp: 14, cone: 24, mouth: 4, spark2: 8, pitPool: 4, work: 2, tBeacon: 3, smoke: 8, truckDust: 9};
const GL: Record<string, number> = {}; let glAcc = 0;
for (const k of Object.keys(GLN) as Array<keyof typeof GLN>) { GL[k] = glAcc; glAcc += GLN[k]; }
const GL_N = glAcc;

// excavator work cycle: [phase, swing, boom raise, stick angle]
const KF: number[][] = [[0, 1.25, 0.2, 0.2], [0.18, 1.3, 0.38, 0.75], [0.3, 1.2, 0.5, 0.15], [0.46, 0.15, 0.62, 0.1], [0.58, 0.05, 0.6, 0.85], [0.72, 0.45, 0.5, 0.45], [0.86, 1.1, 0.3, 0.3], [1, 1.25, 0.2, 0.2]];
const kfv = (ph: number, col: number) => {
  for (let i = 1; i < KF.length; i++) if (ph <= KF[i][0]) { const a = KF[i - 1], b = KF[i], f = smooth(0, 1, (ph - a[0]) / (b[0] - a[0])); return a[col] + (b[col] - a[col]) * f; }
  return KF[KF.length - 1][col];
};

const gp = (gl: ReturnType<typeof makeGlow>, i: number, x: number, y: number, z: number, hex: number, size: number, alpha: number, kind: number, k = 1) => {
  const o = i * 3; gl.pos[o] = x; gl.pos[o + 1] = y; gl.pos[o + 2] = z; setCol(gl.col, i, hex, k); gl.size[i] = size; gl.alpha[i] = alpha; gl.kind[i] = kind;
};

let cableGeo: THREE.BufferGeometry | null = null;
const getCable = () => cableGeo ?? (cableGeo = new THREE.BoxGeometry(0.004, 1, 0.004).translate(0, 0.5, 0));

export default function Mine(p: ModelProps) {
  const full = p.detail !== 'lite';
  const vk = variantOf(p.tileType), v = VARIANTS[vk];
  const owner = p.color && PLAYER_HEX[p.color] ? parseInt(PLAYER_HEX[p.color].slice(1), 16) : 0xffc86a;
  const rights = p.tileType === 9;
  const mirror = useMemo(() => (seeded(p.id)() < 0.5 ? -1 : 1), [p.id]);
  const {geo, ground} = useMemo(() => build(vk, owner, rights, full), [vk, owner, rights, full]);
  const lampP = useMemo(() => {
    const l = lampPatch(9);
    l.lamps.set([FLOODS[0][0], FLOODS[0][2], FLOODS[0][1], 0.8, FLOODS[1][0], FLOODS[1][2], FLOODS[1][1], 0.8, FLOODS[2][0], FLOODS[2][2], FLOODS[2][1], 0.8,
      HF.x, 0.3, HF.z + 0.15, 0.6, BELT_E[0], 0.45, BELT_E[2] + 0.1, 0.5, C.x - 0.1, 0.1, C.z + 0.2, 0.55, C.x + 0.25, 0.14, C.z - 0.05, 0.5, C.x - 0.15, 0.2, C.z - 0.3, 0.5, -0.36, 0.4, -0.5, 0.45]);
    return l;
  }, []);
  const T = useMemo(() => mineTextures(), []);
  const terr = useMemo(() => terrainMaterial(9, lampP.lamps, lampP.uLit), [lampP]);
  const bodyM = useMemo(() => riseMaterial(new THREE.MeshStandardMaterial({vertexColors: true, map: T.grunge, color: new THREE.Color(1.9, 1.9, 1.9), roughness: 0.78, metalness: 0.04}), 'mine-d-body', lampP.extra), [lampP, T]);
  const rise = bodyM.rise;
  const litM = useMemo(() => riseMaterial(new THREE.MeshBasicMaterial({vertexColors: true}), 'mine-d-lit', undefined, rise), [rise]);
  const wheelMat = useMemo(() => new THREE.MeshStandardMaterial({vertexColors: true, roughness: 0.4, metalness: 0.6, emissive: 0x6a6258}), []);
  const truckMat = useMemo(() => new THREE.MeshStandardMaterial({vertexColors: true, roughness: 0.6, metalness: 0.08, color: new THREE.Color(1.5, 1.5, 1.5), emissive: 0x4a3a20}), []);
  const loadMat = useMemo(() => new THREE.MeshStandardMaterial({vertexColors: true, roughness: 0.5, metalness: v.metal, emissive: v.emissive, emissiveIntensity: 0.5, flatShading: true}), [v]);
  const oreMat = useMemo(() => new THREE.MeshStandardMaterial({color: 0xffffff, roughness: 0.3, metalness: 0.75, emissive: v.emissive, emissiveIntensity: 0.9}), [v]);
  const exMat = useMemo(() => new THREE.MeshStandardMaterial({vertexColors: true, roughness: 0.6, metalness: 0.08, color: new THREE.Color(1.5, 1.5, 1.5), emissive: 0x4a3a20}), []);
  const cableMat = useMemo(() => new THREE.MeshBasicMaterial({color: 0x15171a}), []);
  const glow = useMemo(() => makeGlow(GL_N), []);
  const chunk = useMemo(() => G.ico(), []);
  const ore = useRef<THREE.InstancedMesh>(null), trucks = useRef<THREE.InstancedMesh>(null), loads = useRef<THREE.InstancedMesh>(null);
  const wheelRef = useRef<THREE.Mesh>(null), cageRef = useRef<THREE.Mesh>(null), cableRef = useRef<THREE.Mesh>(null);
  const excRef = useRef<THREE.Group>(null), houseRef = useRef<THREE.Group>(null), boomRef = useRef<THREE.Group>(null), stickRef = useRef<THREE.Group>(null);
  const {camera} = useThree();

  useEffect(() => () => { terr.mat.dispose(); bodyM.mat.dispose(); litM.mat.dispose(); wheelMat.dispose(); truckMat.dispose(); loadMat.dispose(); oreMat.dispose(); exMat.dispose(); cableMat.dispose(); glow.points.geometry.dispose(); }, [terr, bodyM, litM, wheelMat, truckMat, loadMat, oreMat, exMat, cableMat, glow]);
  useEffect(() => {
    const m = ore.current; if (!m) return;
    const c = new THREE.Color(), base = new THREE.Color(v.chunk);
    for (let i = 0; i < N_CHUNK; i++) m.setColorAt(i, c.copy(base).multiplyScalar(0.7 + 0.5 * hash(i, 9)).lerp(new THREE.Color(v.pile[i % 3]), 0.25));
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [v, full]);

  const hb = gy(HF.x, HF.z), wy = wheelY();
  const pGy = useMemo(() => PILES.map((q) => gy(q.x, q.z)), []);

  useFrame((state) => {
    const t = world.t, night = p.night;
    const a = world.reduced ? 99 : p.age();
    timeU.value = t;
    setGlowScale(state.size.height * state.gl.getPixelRatio(), (camera as THREE.PerspectiveCamera).fov ?? 40);
    const carve = a >= 99 ? 1 : (() => { const x = ramp(a, 0, 1.9); return x * x * (3 - 2 * x); })();
    terr.uCarve.value = carve;
    rise[0] = easeOutCubic(ramp(a, 1.3, 0.8));
    rise[1] = easeOutBack(ramp(a, 0.9, 1.1));
    rise[2] = easeOutBack(ramp(a, 1.5, 1.3));
    const live = ramp(a, 2.5, 0.6), vis = world.reduced ? 1 : live;
    lampP.uLit.value = night * (0.4 + 0.6 * ramp(a, 1.5, 0.8));
    litM.mat.color.setScalar(0.45 + 0.55 * night);
    truckMat.emissiveIntensity = night * 0.9; wheelMat.emissiveIntensity = night * 0.5; exMat.emissiveIntensity = night * 0.8;
    loadMat.emissiveIntensity = 0.35 + 0.4 * night;
    const gl = glow;
    for (let i = 0; i < GL_N; i++) gl.alpha[i] = 0;
    // headframe beacon + floodlights
    const pulse = 0.65 + 0.35 * Math.sin(t * 3.1);
    const top = hb + HF_H + 0.115;
    gp(gl, GL.beacon, HF.x, top * Math.max(rise[2], 0.001), HF.z, owner, 0.2 + 0.05 * pulse, (0.55 + 0.45 * night) * (0.6 + 0.4 * pulse) * clamp01(rise[2]), 1);
    for (let i = 0; i < 4; i++) {
      const [fx, fz, fh] = FLOODS[i], g = gy(fx, fz);
      gp(gl, GL.flood + i, fx, (g + fh + 0.012) * rise[1], fz + 0.02, 0xfff1cc, 0.2, (0.2 + 0.8 * night) * vis, 1);
      gp(gl, GL.floodPool + i, fx * 0.7 - 0.03, g + 0.02, fz * 0.7, 0xffe2a8, 0.9, 0.4 * night * vis * rise[0], 1, 0.9);
    }
    // conveyor chunks + belt sparkle
    const om = ore.current;
    if (om) {
      const sp = world.reduced ? 0 : 0.085;
      for (let i = 0; i < N_CHUNK; i++) {
        const main = i < 24, u = (t * sp * (main ? 1 : 1.3) + (main ? i / 24 : (i - 24) / 10) + (world.reduced ? 0.03 : 0)) % 1;
        const S = main ? BELT_S : STACK_S, E = main ? BELT_E : STACK_E;
        const x = S[0] + (E[0] - S[0]) * u, y = S[1] + (E[1] - S[1]) * u + 0.016 * rise[1], z = S[2] + (E[2] - S[2]) * u;
        const s = (0.011 + 0.01 * hash(i, 4)) * live * smooth(0, 0.06, u) * smooth(1, 0.94, u);
        dummy.position.set(x + (hash(i, 5) - 0.5) * 0.02, y, z + (hash(i, 6) - 0.5) * 0.02);
        dummy.rotation.set(i, i * 2.3, i * 0.7); dummy.scale.set(s * 1.2, s, s);
        dummy.updateMatrix(); om.setMatrixAt(i, dummy.matrix);
        if (i < 8) {
          const tw = Math.pow(Math.max(0, Math.sin(t * (2.2 + hash(i, 8) * 2) + i * 5.1)), 10);
          gp(gl, GL.spark + i, x, y + 0.015, z, v.spark, 0.1 * (0.4 + tw), (0.1 + tw) * v.sparkle * live * (world.reduced ? 0.6 : 1), 2);
        }
      }
      om.instanceMatrix.needsUpdate = true;
    }
    // sparkles on the piles
    for (let i = 0; i < 12; i++) {
      const pi = i % 4, q = PILES[pi];
      const tw = Math.pow(Math.max(0, Math.sin(t * (1.3 + hash(i, 12)) + i * 2.7)), 12);
      const ang = hash(i, 11) * 6.283, d = q.r * (0.15 + 0.55 * hash(i, 13));
      gp(gl, GL.pileSpark + i, q.x + Math.cos(ang) * d, pGy[pi] + q.h * (1 - d / q.r) * 0.9 * rise[1] + 0.015, q.z + Math.sin(ang) * d, v.spark, 0.12 * (0.3 + tw), tw * v.sparkle * (1 + 1.5 * night) * rise[1] * (world.reduced ? 0.7 : 1), 2);
    }
    // haul trucks
    const tm = trucks.current, lm = loads.current;
    for (let k = 0; k < N_TRUCK; k++) {
      const c = world.reduced ? 3 + k * 6 : (t + k * (CYCLE / N_TRUCK)) % CYCLE;
      let u: number, turn: number;
      if (c < 8.5) { u = smooth(0, 1, c / 8.5); turn = 0; }
      else if (c < 9.5) { u = 1; turn = smooth(0, 1, c - 8.5); }
      else if (c < 18) { u = 1 - smooth(0, 1, (c - 9.5) / 8.5); turn = 1; }
      else { u = 0; turn = 1 - smooth(0, 1, (c - 18) / 3); }
      const lane = -0.021 + 0.042 * turn;
      const phi = PHI * 0.975 * (1 - u), th = roadTh(phi), rr = roadR(phi) + lane;
      const x = C.x + Math.cos(th) * rr, z = C.z + Math.sin(th) * rr, y = roadH(phi) + 0.012;
      const th2 = roadTh(phi - 0.05), rr2 = roadR(phi - 0.05) + lane;
      const hx = C.x + Math.cos(th2) * rr2 - x, hz = C.z + Math.sin(th2) * rr2 - z, hy = roadH(phi - 0.05) - roadH(phi);
      const yaw = Math.atan2(hx, hz) + Math.PI * turn;
      const pitch = -Math.atan2(hy, Math.hypot(hx, hz)) * (1 - 2 * turn);
      const sc = vis;
      dummy.position.set(x, y * rise[0], z); dummy.rotation.set(pitch, yaw, 0); dummy.scale.set(sc, sc, sc);
      dummy.updateMatrix();
      tm?.setMatrixAt(k, dummy.matrix);
      const ls = (c > 17.2 || c < 8.8) ? sc * (c > 17.2 ? smooth(17.2, 18.4, c) : 1 - smooth(8.4, 8.9, c)) : 0;
      if (lm) { dummy.scale.set(ls, ls, ls); dummy.updateMatrix(); lm.setMatrixAt(k, dummy.matrix); }
      const fwx = Math.sin(yaw), fwz = Math.cos(yaw);
      for (let s = 0; s < 2; s++) {
        const idx = GL.head + k * 2 + s, side = s ? 0.022 : -0.022;
        gp(gl, idx, x + fwx * 0.075 + fwz * side, y * rise[0] + 0.03, z + fwz * 0.075 - fwx * side, 0xfff3d0, 0.07, (0.25 + 0.75 * night) * vis, 1);
      }
      for (let b = 0; b < 4; b++) {
        const idx = GL.beam + k * 4 + b, d = 0.1 + b * 0.07;
        gp(gl, idx, x + fwx * d, y * rise[0] + 0.026 - b * 0.004, z + fwz * d, 0xfff0c0, 0.07 + b * 0.04, (0.06 + 0.3 * night) * vis * (1 - b * 0.18), 1);
      }
      gp(gl, GL.tBeacon + k, x, y * rise[0] + 0.085, z, 0xffa010, 0.07, (Math.sin(t * 6 + k * 2) > 0 ? 0.9 : 0.15) * vis * (0.4 + 0.6 * night), 1);
      if (full) for (let d = 0; d < 3; d++) {
        const life = ((t * 0.5 + d / 3 + k * 0.3) % 1), idx = GL.truckDust + k * 3 + d;
        gp(gl, idx, x - fwx * (0.06 + life * 0.1), y * rise[0] + 0.02 + life * 0.04, z - fwz * (0.06 + life * 0.1), v.strata[4], 0.06 + life * 0.1, 0.18 * Math.sin(life * 3.14) * vis * (u > 0.02 && u < 0.98 ? 1 : 0.1) * (world.reduced ? 0.4 : 1), 0, 1.1);
      }
    }
    if (tm) tm.instanceMatrix.needsUpdate = true;
    if (lm) lm.instanceMatrix.needsUpdate = true;
    // dust from the crusher, the plant stack's smoke, and the build's debris
    const nDust = full ? 12 : 4;
    for (let i = 0; i < nDust; i++) {
      const life = ((t * 0.22 + hash(i, 21)) % 1);
      const ox = i < 8 ? BELT_E[0] + 0.05 : C.x - 0.2, oz = i < 8 ? BELT_E[2] + 0.02 : C.z - 0.35;
      gp(gl, GL.dust + i, ox + (hash(i, 22) - 0.5) * 0.12 + life * 0.12, (i < 8 ? 0.5 : 0.17) + life * 0.28 * (i < 8 ? 1 : 0.5), oz + (hash(i, 23) - 0.5) * 0.08, v.strata[3], 0.08 + life * 0.16, (i < 8 ? 0.22 : 0.14) * Math.sin(life * Math.PI) * live * (world.reduced ? 0.5 : 1), 0, 1.1);
    }
    for (let i = 0; i < GLN.smoke; i++) {
      const life = ((t * 0.12 + i / GLN.smoke) % 1);
      gp(gl, GL.smoke + i, -0.53 + life * 0.16 + Math.sin(life * 6 + i) * 0.015, (gy(-0.36, -0.52) + 0.32 + life * 0.35) * rise[1], -0.59 - life * 0.05, 0x8a8480, 0.05 + life * 0.15, 0.3 * Math.sin(life * Math.PI) * live * (world.reduced ? 0.6 : 1), 0, 0.9);
    }
    if (a < 3) for (let i = 0; i < GLN.buildDust; i++) {
      const life = clamp01((a - 0.1 - hash(i, 31) * 0.8) / 1.3), ang = hash(i, 32) * 6.283, rad = 0.1 + life * 0.45;
      gp(gl, GL.buildDust + i, C.x + Math.cos(ang) * rad, 0.2 + life * 0.35, C.z + Math.sin(ang) * rad, v.strata[4], 0.12 + life * 0.28, life > 0 && life < 1 ? 0.5 * Math.sin(life * Math.PI) : 0, 0, 1.2);
    }
    // night extras: light cones, pools in the pit, road lamps, crusher windows
    const nz = night * live;
    for (let i = 0; i < 4; i++) {
      const [fx, fz, h] = FLOODS[i], g = gy(fx, fz);
      const tx = C.x + (i === 0 ? 0.1 : i === 1 ? -0.05 : 0.05), tz = C.z + (i === 2 ? 0.1 : i === 3 ? -0.1 : 0);
      if (full) for (let k = 0; k < 6; k++) {
        const u = (k + 1) / 6.5;
        gp(gl, GL.cone + i * 6 + k, fx + (tx - fx) * u, (g + h + (0.1 - g - h) * u) * rise[1], fz + (tz - fz) * u, 0xffe6b0, 0.12 + u * 0.32, 0.15 * nz * (1 - 0.5 * u), 1);
      }
      gp(gl, GL.pitPool + i, tx, 0.14 * rise[0], tz, 0xffc878, 0.7, 0.2 * nz * rise[0], 1);
    }
    for (let i = 0; i < N_RL; i++) {
      const phi = ((i + 0.5) / N_RL) * PHI * 0.96, th = roadTh(phi), r = roadR(phi) + 0.075;
      gp(gl, GL.roadLamp + i, C.x + Math.cos(th) * r, (roadH(phi) + 0.04) * rise[0], C.z + Math.sin(th) * r, 0xffd890, 0.075, (0.15 + 0.85 * night) * live * rise[0], 1);
    }
    gp(gl, GL.mouth, BELT_E[0], (BELT_E[1] - 0.02) * rise[1], BELT_E[2] + 0.1, 0xff9a40, 0.3, (0.3 + 0.55 * night) * live * (0.85 + 0.15 * Math.sin(t * 7)), 1);
    gp(gl, GL.mouth + 1, WIND.x, (gy(WIND.x, WIND.z) + 0.05) * rise[2], WIND.z + 0.1, 0xffd27a, 0.3, 0.35 * nz, 1);
    gp(gl, GL.mouth + 2, -0.36, (gy(-0.36, -0.52) + 0.05) * rise[1], -0.52 + 0.1, 0xffc86a, 0.35, 0.35 * nz, 1);
    gp(gl, GL.mouth + 3, -0.53, (gy(-0.36, -0.52) + 0.315) * rise[1], -0.59, 0xff6a1a, 0.16, 0.55 * live * (0.85 + 0.15 * Math.sin(t * 5)), 1);
    if (full) for (let i = 0; i < 8; i++) {
      const pi = i % 4, q = PILES[pi];
      const tw = Math.pow(Math.max(0, Math.sin(t * (1.7 + hash(i, 74) * 1.5) + i * 3.3)), 8);
      gp(gl, GL.spark2 + i, q.x + (hash(i, 71) - 0.5) * q.r * 1.2, pGy[pi] + q.h * (0.1 + 0.4 * hash(i, 72)) * rise[1], q.z + (hash(i, 73) - 0.3) * q.r, v.spark, 0.14 * (0.3 + tw), tw * v.sparkle * (0.3 + 1.4 * night) * rise[1] * (world.reduced ? 0.6 : 1), 2);
    }
    // excavator and its work light
    const ex = excRef.current;
    if (ex) {
      const drop = easeOutCubic(ramp(a, 1.9, 0.5));
      ex.position.set(EXC.x, EXC.y + (1 - drop) * 0.6, EXC.z); ex.scale.setScalar(EXC.s * Math.max(drop, 0.001));
      const ph = world.reduced ? 0.12 : (t * 0.14) % 1;
      if (houseRef.current) houseRef.current.rotation.y = kfv(ph, 1);
      if (boomRef.current) boomRef.current.rotation.x = -kfv(ph, 2);
      if (stickRef.current) stickRef.current.rotation.x = kfv(ph, 3);
      gp(gl, GL.work, EXC.x, EXC.y + 0.06, EXC.z, 0xffe2a0, 0.1, 0.5 * night * drop, 1);
      if (!world.reduced && Math.abs(ph - 0.3) < 0.07) gp(gl, GL.work + 1, EXC.x - 0.1, EXC.y + 0.03, EXC.z - 0.04, v.strata[4], 0.12, 0.35 * (1 - Math.abs(ph - 0.3) / 0.07), 0, 1.1);
    }
    gl.dirty();
    // sheave wheel + hoist cage
    const wh = wheelRef.current;
    if (wh) {
      const s = easeOutBack(ramp(a, 2.2, 0.5));
      wh.scale.setScalar(Math.max(0.001, s));
      wh.rotation.x = world.reduced ? 0.4 : t * 1.6 + 14 * (1 - easeOutCubic(ramp(a, 2.2, 1.6)));
      wh.position.set(HF.x, wy * Math.max(rise[2], 0.001), HF.z);
    }
    const cg = cageRef.current, cb = cableRef.current;
    if (cg && cb) {
      const ph = world.reduced ? 0.3 : (t * 0.09) % 1, f = ph < 0.5 ? smooth(0, 1, ph * 2) : 1 - smooth(0, 1, ph * 2 - 1);
      const cy = (hb + 0.035 + f * 0.55) * Math.max(rise[2], 0.001);
      cg.position.set(HF.x, cy, HF.z); cg.scale.setScalar(Math.max(rise[2], 0.001));
      cb.position.set(HF.x, cy + 0.075, HF.z); cb.scale.set(1, Math.max(0.001, (wy * Math.max(rise[2], 0.001) - cy - 0.075)), 1);
    }
  });

  return (
    <group position={[0, p.top, 0]} scale={[p.radius * mirror, p.radius, p.radius]}>
      <mesh geometry={ground} material={terr.mat} frustumCulled={false} />
      <mesh geometry={geo.body} material={bodyM.mat} />
      <mesh geometry={geo.lit} material={litM.mat} />
      <mesh ref={wheelRef} geometry={geo.wheel} material={wheelMat} />
      <instancedMesh ref={trucks} args={[geo.truck, truckMat, N_TRUCK]} frustumCulled={false} />
      {full && (
        <>
          <instancedMesh ref={loads} args={[geo.load, loadMat, N_TRUCK]} frustumCulled={false} />
          <instancedMesh ref={ore} args={[chunk, oreMat, N_CHUNK]} frustumCulled={false} />
          <mesh ref={cageRef} geometry={geo.cage} material={exMat} frustumCulled={false} />
          <mesh ref={cableRef} geometry={getCable()} material={cableMat} frustumCulled={false} />
          <group ref={excRef} rotation={[0, EXC.yaw, 0]}>
            <mesh geometry={geo.exTracks} material={exMat} />
            <group ref={houseRef}>
              <mesh geometry={geo.exHouse} material={exMat} />
              <group ref={boomRef} position={EXC_BOOM as unknown as [number, number, number]}>
                <mesh geometry={geo.exBoom} material={exMat} />
                <group ref={stickRef} position={EXC_STICK as unknown as [number, number, number]}>
                  <mesh geometry={geo.exStick} material={exMat} />
                </group>
              </group>
            </group>
          </group>
        </>
      )}
      <primitive object={glow.points} />
    </group>
  );
}
