// Mining Area / Mining Rights / steel and titanium mining bonus tiles: an open-pit mine with stepped terraces and a
// spiral haul road, a lattice headframe with a turning sheave wheel and an owner-coloured beacon, a conveyor carrying
// glinting ore up to a crusher, two haul trucks with headlights, tinted ore piles and floodlights that bloom at night.
// Build-in: the pit digs itself into terraces, the headframe rises, the wheel spins up, the trucks start rolling.
import {useFrame, useThree} from '@react-three/fiber';
import {useEffect, useMemo, useRef} from 'react';
import * as THREE from 'three';
import {PLAYER_HEX} from '../../../../../shared/game';
import {seeded, world} from '../tiles3d';
import type {ModelMeta, ModelProps} from './contract';
import {Builder, G, clamp01, easeOutBack, easeOutCubic, hash, lampPatch, makeGlow, ramp, riseMaterial, setCol, setGlowScale, smooth, timeU, triCount} from './MineKit';

export const meta: ModelMeta = {name: 'Mine', tileTypes: [8, 9, 27, 28], kind: 'special', buildSeconds: 2.2};

type Variant = {strata: number[]; pile: number[]; chunk: number; emissive: number; spark: number; sparkle: number};
const VARIANTS: Record<string, Variant> = {
  area: {strata: [0x5a4034, 0x6d4f3c, 0x7f5c43, 0x8a6648, 0x93724f], pile: [0x8a5e40, 0x76787c, 0x6a6258], chunk: 0xb59a7e, emissive: 0x3a2a1a, spark: 0xffe0b0, sparkle: 0.5},
  steel: {strata: [0x5a2c20, 0x6c3a2a, 0x7f4631, 0x8f5238, 0x9a5c3f], pile: [0xa0482a, 0x8a3b22, 0xb4603a], chunk: 0xc2603a, emissive: 0x6a2410, spark: 0xffb27a, sparkle: 0.7},
  titanium: {strata: [0x39424f, 0x48535f, 0x586674, 0x66778a, 0x748aa0], pile: [0x9fb8d8, 0x7fa0c8, 0xbfd3ec], chunk: 0xbcd6f4, emissive: 0x2a5a9a, spark: 0xcfeaff, sparkle: 1},
};
const variantOf = (t: number) => (t === 27 ? 'steel' : t === 28 ? 'titanium' : 'area');

// ---- layout (unit space: hex circumradius 1) -------------------------------------------------------------
const PIT = {x: -0.14, z: -0.03};
const R_BREAK: Array<[number, number]> = [[0, 0.04], [0.19, 0.03], [0.23, 0.1], [0.32, 0.1], [0.36, 0.17], [0.45, 0.17], [0.49, 0.24], [0.54, 0.24], [0.69, 0.0], [1, 0]];
const RINGS = [0, 0.06, 0.12, 0.17, 0.21, 0.25, 0.29, 0.33, 0.37, 0.41, 0.45, 0.48, 0.51, 0.54, 0.58, 0.62, 0.66, 0.7];
const SEG = 56;
const PHI = Math.PI * 2 * 1.15;
const TH0 = 0.6;
const roadR = (phi: number) => 0.5 - 0.31 * (phi / PHI);
const roadH = (phi: number) => 0.25 - 0.21 * (phi / PHI);
const roadTh = (phi: number) => TH0 - phi;
const roadX = (phi: number) => PIT.x + roadR(phi) * Math.cos(roadTh(phi));
const roadZ = (phi: number) => PIT.z + roadR(phi) * Math.sin(roadTh(phi));
const BELT_S: [number, number, number] = [-0.22, 0.07, -0.12];
const BELT_E: [number, number, number] = [0.08, 0.37, -0.55];
const FLOODS: Array<[number, number, number]> = [[0.62, 0.26, 0.4], [-0.62, -0.4, 0.36], [0.2, -0.8, 0.34]];

function baseHeight(r: number) {
  for (let i = 1; i < R_BREAK.length; i++) if (r <= R_BREAK[i][0]) { const [r0, h0] = R_BREAK[i - 1], [r1, h1] = R_BREAK[i]; return h0 + (h1 - h0) * (r - r0) / (r1 - r0); }
  return 0;
}

function terrain(v: Variant): THREE.BufferGeometry {
  const rows = RINGS.length, cols = SEG;
  const pos = new Float32Array(rows * cols * 3), col = new Float32Array(rows * cols * 3);
  const c = new THREE.Color(), c2 = new THREE.Color();
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const th = (j / cols) * Math.PI * 2, r = RINGS[i];
      let h = baseHeight(r);
      // blend toward the haul road wherever it passes
      let wBest = 0, hRoad = 0;
      for (let k = 0; k < 2; k++) {
        const phi = ((TH0 - th) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) + k * Math.PI * 2;
        if (phi > PHI) continue;
        const d = Math.abs(r - roadR(phi));
        const w = 1 - smooth(0.035, 0.1, d);
        if (w > wBest) { wBest = w; hRoad = roadH(phi); }
      }
      h += (hRoad - h) * wBest;
      h += (hash(i * 97 + j, 3) - 0.5) * 0.012 * (h > 0.01 ? 1 : 0);
      const o = (i * cols + j) * 3;
      pos[o] = PIT.x + Math.cos(th) * r; pos[o + 1] = h; pos[o + 2] = PIT.z + Math.sin(th) * r;
      // strata colour by height, darker in the pit, ground-toned outside the berm
      const f = clamp01(h / 0.26) * (v.strata.length - 1), i0 = Math.floor(f), i1 = Math.min(v.strata.length - 1, i0 + 1);
      c.setHex(v.strata[i0]); c2.setHex(v.strata[i1]); c.lerp(c2, f - i0);
      const k = 1.0 + 0.34 * hash(i * 31 + j, 7) * 0.5 + (h < 0.02 ? -0.25 * (1 - h / 0.02) : 0) + (wBest > 0.5 ? -0.28 + 0.1 * wBest : 0);
      const slope = Math.abs(baseHeight(r + 0.025) - baseHeight(Math.max(0, r - 0.025))) / 0.05 * 0.25;
      c.multiplyScalar((1.55 - 1.3 * clamp01(slope * 4)) * (1 + 0.07 * (Math.floor(h / 0.1) % 2 ? 1 : -1)));
      if (wBest > 0.6) c.lerp(c2.setHex(0x3a3532), 0.65);
      col[o] = c.r * k; col[o + 1] = c.g * k; col[o + 2] = c.b * k;
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < rows - 1; i++) for (let j = 0; j < cols; j++) {
    const a = i * cols + j, b = i * cols + (j + 1) % cols, d = (i + 1) * cols + j, e = (i + 1) * cols + (j + 1) % cols;
    idx.push(a, b, d, b, e, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(rows * cols * 2), 2));
  g.setAttribute('aGrp', new THREE.BufferAttribute(new Float32Array(rows * cols), 1));
  g.setIndex(idx);
  const flat = g.toNonIndexed();
  flat.computeVertexNormals();
  return flat;
}

const RC = new THREE.Color();
function roadRibbon(): THREE.BufferGeometry {
  const N = 84, W = [-0.05, -0.041, 0.041, 0.05];
  const pos = new Float32Array((N + 1) * 4 * 3), col = new Float32Array((N + 1) * 4 * 3);
  for (let n = 0; n <= N; n++) {
    const phi = (n / N) * PHI * 0.985, th = roadTh(phi), rr = roadR(phi), y = roadH(phi) + 0.02;
    for (let k = 0; k < 4; k++) {
      const r = rr + W[k], o = (n * 4 + k) * 3;
      pos[o] = PIT.x + Math.cos(th) * r; pos[o + 1] = y + (k === 0 || k === 3 ? 0.008 : 0); pos[o + 2] = PIT.z + Math.sin(th) * r;
      const edge = k === 0 || k === 3;
      const stripe = edge && Math.floor(n / 2) % 2 === 0;
      const base = edge ? (stripe ? 0xa8946c : 0x4a4034) : 0x26231f;
      RC.setHex(base); col[o] = RC.r; col[o + 1] = RC.g; col[o + 2] = RC.b;
    }
  }
  const idx: number[] = [];
  for (let n = 0; n < N; n++) for (let k = 0; k < 3; k++) { const a = n * 4 + k, b = a + 1, c = a + 4, d = a + 5; idx.push(a, c, b, b, c, d); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array((N + 1) * 4 * 2), 2));
  g.setAttribute('aGrp', new THREE.BufferAttribute(new Float32Array((N + 1) * 4), 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

type Built = {body: THREE.BufferGeometry; lit: THREE.BufferGeometry; wheel: THREE.BufferGeometry; truck: THREE.BufferGeometry; tris: number};
const built = new Map<string, Built>();
const HEADFRAME = {x: 0.46, z: -0.42};

function build(vk: string, owner: number, rights: boolean): Built {
  const key = `${vk}|${owner}|${rights}`;
  let b = built.get(key);
  if (b) return b;
  const v = VARIANTS[vk];
  const B = new Builder(), L = new Builder();
  // group 0: terrain and road
  B.grp = 0;
  B.parts.push(terrain(v), roadRibbon());
  // lamps along the haul road (terrain group, so they rise with the pit)
  L.grp = 0;
  for (let i = 0; i < N_RL; i++) {
    const phi = ((i + 0.5) / N_RL) * PHI * 0.96, th = roadTh(phi), r = roadR(phi) + 0.062;
    L.box(PIT.x + Math.cos(th) * r - 0.009, roadH(phi) + 0.026, PIT.z + Math.sin(th) * r - 0.009, 0.018, 0.018, 0.018, 0xffe2a0);
    B.grp = 0; B.cyl(PIT.x + Math.cos(th) * r, roadH(phi) + 0.01, PIT.z + Math.sin(th) * r, 0.004, 0.02, 0x2a2d31, 1, 5);
  }
  // group 1: conveyor, crusher, piles, floodlight poles
  B.grp = 1; L.grp = 1;
  const [sx, sy, sz] = BELT_S, [ex, ey, ez] = BELT_E;
  B.bar(sx, sy, sz, ex, ey, ez, 0.055, 0x3c3f44, [0.8, 1]);
  B.bar(sx, sy + 0.03, sz, ex, ey + 0.03, ez, 0.03, 0x8a8f96, [0.9, 1]);
  for (const t of [0.12, 0.38, 0.62, 0.86]) {
    const x = sx + (ex - sx) * t, y = sy + (ey - sy) * t, z = sz + (ez - sz) * t;
    B.bar(x, 0, z, x, y - 0.02, z, 0.02, 0x55595f);
    L.box(x - 0.012, y + 0.035, z - 0.012, 0.024, 0.014, 0.024, t > 0.5 ? 0xffb347 : 0x6dff9a);
  }
  // crusher and hopper
  B.box(ex - 0.08, 0, ez - 0.07, 0.16, 0.2, 0.15, 0x5b5f66, {ao: [0.55, 1]});
  B.cyl(ex, 0.2, ez, 0.12, 0.11, 0x7a7f87, 0.55, 10);
  B.box(ex + 0.02, 0.06, ez + 0.075, 0.07, 0.07, 0.04, 0x3c3f44);
  L.box(ex - 0.045, 0.12, ez + 0.078, 0.05, 0.03, 0.006, 0xffd27a);
  L.cyl(ex, 0.311, ez, 0.055, 0.006, 0xffb050, 1, 10);
  // chute into the first pile
  B.bar(ex + 0.04, 0.1, ez - 0.04, ex + 0.2, 0.05, ez - 0.1, 0.04, 0x44484e);
  // ore piles
  const pile = (x: number, z: number, r: number, h: number, ci: number, rot = 0) => B.add(G.cone(7), x, h / 2, z, v.pile[ci % v.pile.length], {sx: r, sy: h, sz: r, ry: rot, ao: [0.55, 1.05]});
  pile(0.32, -0.68, 0.14, 0.13, 0); pile(0.22, -0.7, 0.09, 0.09, 1, 1); pile(-0.08, -0.72, 0.1, 0.1, 2, 0.5);
  pile(0.58, 0.14, 0.1, 0.08, 1, 0.3); pile(0.66, -0.02, 0.07, 0.06, 0, 1.2); pile(-0.55, 0.5, 0.08, 0.06, 2, 0.7);
  for (let i = 0; i < 5; i++) B.add(G.ico(), 0.3 + (hash(i, 1) - 0.5) * 0.3, 0.015, -0.62 + (hash(i, 2) - 0.5) * 0.2, v.pile[i % 3], {sx: 0.025, sy: 0.02, sz: 0.025, ry: i});
  // floodlight poles
  for (const [fx, fz, h] of FLOODS) {
    B.cyl(fx, 0, fz, 0.012, h, 0x444850, 0.7, 6);
    B.box(fx - 0.03, h, fz - 0.015, 0.06, 0.02, 0.03, 0x2a2d31);
    L.box(fx - 0.026, h - 0.008, fz - 0.013, 0.052, 0.012, 0.026, 0xfff4d6);
  }
  // survey flags for Mining Rights
  if (rights) for (let i = 0; i < 5; i++) {
    const a = 0.3 + i * 1.1, fx = Math.cos(a) * 0.72 * 0.95, fz = Math.sin(a) * 0.62 + 0.1;
    if (fz > 0.55 || fz < -0.7) continue;
    B.cyl(fx, 0, fz, 0.006, 0.12, 0xeeeeee, 1, 5);
    L.box(fx, 0.09, fz, 0.05, 0.03, 0.004, owner);
  }
  // group 2: headframe
  B.grp = 2; L.grp = 2;
  const hx = HEADFRAME.x, hz = HEADFRAME.z, H = 0.82;
  for (const sxn of [-1, 1]) for (const szn of [-1, 1]) B.bar(hx + sxn * 0.11, 0, hz + szn * 0.11, hx + sxn * 0.035, H, hz + szn * 0.035, 0.026, 0x4a5058, [0.7, 1]);
  for (const f of [0.2, 0.45, 0.7]) {
    const wx = 0.11 - 0.075 * f, y = H * f;
    B.bar(hx - wx, y, hz - wx, hx + wx, y, hz - wx, 0.014, 0x6a7078); B.bar(hx + wx, y, hz - wx, hx + wx, y, hz + wx, 0.014, 0x6a7078);
    B.bar(hx + wx, y, hz + wx, hx - wx, y, hz + wx, 0.014, 0x6a7078); B.bar(hx - wx, y, hz + wx, hx - wx, y, hz - wx, 0.014, 0x6a7078);
  }
  for (const sxn of [-1, 1]) {
    B.bar(hx + sxn * 0.11, 0, hz - 0.11, hx + sxn * 0.06, H * 0.46, hz + 0.06 * -1, 0.011, 0x6a7078);
    B.bar(hx + sxn * 0.06, H * 0.46, hz - 0.06, hx + sxn * 0.04, H * 0.8, hz - 0.04, 0.011, 0x6a7078);
  }
  B.box(hx - 0.06, H, hz - 0.07, 0.12, 0.07, 0.14, 0x7a2f26 + 0, {ao: [0.8, 1]});
  B.box(hx - 0.07, H + 0.07, hz - 0.08, 0.14, 0.012, 0.16, 0x2f3338);
  // wheel stands + cables
  B.box(hx - 0.05, H + 0.08, hz - 0.012, 0.012, 0.09, 0.024, 0x2f3338); B.box(hx + 0.038, H + 0.08, hz - 0.012, 0.012, 0.09, 0.024, 0x2f3338);
  B.bar(hx, H + 0.16, hz - 0.085, hx, 0.01, hz - 0.2, 0.006, 0x1d1f22);
  B.bar(hx, H + 0.16, hz + 0.085, hx, 0.01, hz + 0.2, 0.006, 0x1d1f22);
  B.box(hx - 0.07, 0, hz + 0.18, 0.14, 0.05, 0.09, 0x4a4f56); // winding house
  L.box(hx - 0.05, 0.03, hz + 0.226, 0.1, 0.02, 0.004, 0xffd27a);
  // owner beacon
  B.cyl(hx, H + 0.17, hz, 0.006, 0.07, 0x2f3338, 1, 5);
  L.add(G.sph(), hx, H + 0.26, hz, owner, {sx: 0.04, sy: 0.04, sz: 0.04, ao: [1, 1]});
  L.box(hx - 0.03, H + 0.075, hz + 0.074, 0.06, 0.02, 0.006, 0xffd27a);

  // wheel (its own mesh, turns about x)
  const W = new Builder();
  W.add(G.torus(0.1), 0, 0, 0, 0xc8ccd2, {sx: 0.085, sy: 0.085, sz: 0.085, ry: Math.PI / 2, ao: [1, 1]});
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI; W.bar(0, Math.cos(a) * 0.085, Math.sin(a) * 0.085, 0, -Math.cos(a) * 0.085, -Math.sin(a) * 0.085, 0.009, 0x9aa0a8, [1, 1]); }
  W.add(G.cyl(1, 8), 0, 0, 0, 0xffb347, {rz: Math.PI / 2, sx: 0.02, sy: 0.04, sz: 0.02, ao: [1, 1]});
  // truck: bed, cab, wheels, load
  const T = new Builder();
  T.box(-0.04, 0.025, -0.085, 0.08, 0.04, 0.11, 0xe8a317, {ao: [0.7, 1]});
  T.box(-0.035, 0.065, -0.082, 0.07, 0.03, 0.1, v.pile[0], {ao: [0.8, 1]});
  T.box(-0.038, 0.025, 0.03, 0.076, 0.055, 0.045, 0xe8a317);
  T.box(-0.034, 0.06, 0.04, 0.068, 0.02, 0.02, 0x20262c);
  for (const [wx, wz] of [[-0.044, -0.06], [0.044, -0.06], [-0.044, 0.04], [0.044, 0.04]]) T.box(wx - 0.01, 0, wz - 0.02, 0.02, 0.036, 0.04, 0x1c1d1f);
  const body = B.build(), lit = L.build(), wheel = W.build(), truck = T.build();
  b = {body, lit, wheel, truck, tris: triCount(body) + triCount(lit) + triCount(wheel) + triCount(truck)};
  built.set(key, b);
  return b;
}

const live2 = (a: number) => 0.4 + 0.6 * ramp(a, 1.4, 0.6);
const N_RL = 14;
const N_CHUNK = 20, N_TRUCK = 2;
const dummy = new THREE.Object3D();
const GL = {beacon: 0, flood: 1, floodPool: 4, head: 7, spark: 11, pileSpark: 19, dust: 25, buildDust: 37, roadLamp: 50, cone: 64, beam: 82, mouth: 90, pitPool: 92, spark2: 95, n: 103};
const CYCLE = 18;

export default function Mine(p: ModelProps) {
  const vk = variantOf(p.tileType);
  const v = VARIANTS[vk];
  const owner = p.color && PLAYER_HEX[p.color] ? parseInt(PLAYER_HEX[p.color].slice(1), 16) : 0xffc86a;
  const rights = p.tileType === 9;
  const mirror = useMemo(() => (seeded(p.id)() < 0.5 ? -1 : 1), [p.id]);
  const geo = useMemo(() => build(vk, owner, rights), [vk, owner, rights]);
  const lampP = useMemo(() => lampPatch(9), []);
  const bodyM = useMemo(() => riseMaterial(new THREE.MeshStandardMaterial({vertexColors: true, roughness: 0.88, metalness: 0.08, side: THREE.DoubleSide}), 'mine-body', lampP.extra), [lampP]);
  const rise = bodyM.rise;
  const litM = useMemo(() => riseMaterial(new THREE.MeshBasicMaterial({vertexColors: true}), 'mine-lit', undefined, bodyM.rise), [bodyM]);
  const wheelMat = useMemo(() => new THREE.MeshStandardMaterial({vertexColors: true, roughness: 0.4, metalness: 0.6, emissive: 0x6a6258}), []);
  const truckMat = useMemo(() => new THREE.MeshStandardMaterial({vertexColors: true, roughness: 0.7, metalness: 0.2, emissive: 0x4a3a20}), []);
  const oreMat = useMemo(() => new THREE.MeshStandardMaterial({color: 0xffffff, roughness: 0.3, metalness: 0.75, emissive: v.emissive, emissiveIntensity: 0.9}), [v]);
  const glow = useMemo(() => makeGlow(GL.n), []);
  const ore = useRef<THREE.InstancedMesh>(null);
  const trucks = useRef<THREE.InstancedMesh>(null);
  const wheelRef = useRef<THREE.Mesh>(null);
  const root = useRef<THREE.Group>(null);
  const chunk = useMemo(() => G.ico(), []);
  const {camera} = useThree();

  useEffect(() => () => { bodyM.mat.dispose(); litM.mat.dispose(); wheelMat.dispose(); truckMat.dispose(); oreMat.dispose(); glow.points.geometry.dispose(); }, [bodyM, litM, wheelMat, truckMat, oreMat, glow]);
  useEffect(() => {
    const m = ore.current; if (!m) return;
    const c = new THREE.Color(), base = new THREE.Color(v.chunk);
    for (let i = 0; i < N_CHUNK; i++) m.setColorAt(i, c.copy(base).multiplyScalar(0.7 + 0.5 * hash(i, 9)).lerp(new THREE.Color(v.pile[i % 3]), 0.25));
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [v]);

  useFrame((state) => {
    const t = world.t, night = p.night;
    const a = world.reduced ? 99 : p.age();
    timeU.value = t;
    setGlowScale(state.size.height * state.gl.getPixelRatio(), (camera as THREE.PerspectiveCamera).fov ?? 40);
    // build-in
    rise[0] = easeOutCubic(ramp(a, 0, 1.0));
    rise[1] = easeOutBack(ramp(a, 0.5, 0.9));
    rise[2] = easeOutBack(ramp(a, 0.75, 1.1));
    const live = ramp(a, 1.6, 0.5);
    lampP.uLit.value = night * live2(a);
    truckMat.emissiveIntensity = night * 0.9; wheelMat.emissiveIntensity = night * 0.5;
    const gl = glow;
    // beacon + floodlights
    const pulse = 0.65 + 0.35 * Math.sin(t * 3.1);
    const vis = world.reduced ? 1 : live;
    gl.pos[0] = HEADFRAME.x; gl.pos[1] = 0.34 + 0.82 * 0 + 0.0; gl.pos[2] = HEADFRAME.z;
    gl.pos[1] = 1.08 * rise[2] + 0.0; if (rise[2] < 0.01) gl.pos[1] = 0;
    setCol(gl.col, GL.beacon, owner); gl.size[GL.beacon] = 0.22 + 0.05 * pulse; gl.alpha[GL.beacon] = (0.55 + 0.45 * night) * (0.6 + 0.4 * pulse) * clamp01(rise[2]);
    for (let i = 0; i < 3; i++) {
      const [fx, fz, h] = FLOODS[i];
      const o = (GL.flood + i) * 3;
      gl.pos[o] = fx; gl.pos[o + 1] = h * rise[1]; gl.pos[o + 2] = fz;
      setCol(gl.col, GL.flood + i, 0xfff1cc); gl.size[GL.flood + i] = 0.2; gl.alpha[GL.flood + i] = (0.2 + 0.8 * night) * vis;
      const q = (GL.floodPool + i) * 3;
      gl.pos[q] = fx * 0.8 - 0.05; gl.pos[q + 1] = 0.02; gl.pos[q + 2] = fz * 0.8; setCol(gl.col, GL.floodPool + i, 0xffe2a8, 0.9);
      gl.size[GL.floodPool + i] = 0.9; gl.alpha[GL.floodPool + i] = 0.4 * night * vis * rise[0]; gl.kind[GL.floodPool + i] = 1;
    }
    for (let i = 0; i < 3; i++) { const L = lampP.lamps, o = i * 4; L[o] = FLOODS[i][0]; L[o + 1] = FLOODS[i][2]; L[o + 2] = FLOODS[i][1]; L[o + 3] = 0.8; }
    lampP.lamps.set([HEADFRAME.x, 0.3, HEADFRAME.z + 0.15, 0.6, BELT_E[0], 0.25, BELT_E[2] + 0.1, 0.5,
      PIT.x - 0.1, 0.1, PIT.z + 0.2, 0.55, PIT.x + 0.25, 0.14, PIT.z - 0.05, 0.5, PIT.x - 0.15, 0.2, PIT.z - 0.3, 0.5], 12);
    // conveyor chunks
    const om = ore.current;
    if (om) {
      const sp = world.reduced ? 0 : 0.085;
      for (let i = 0; i < N_CHUNK; i++) {
        const u = (t * sp + i / N_CHUNK + (world.reduced ? 0.03 : 0)) % 1;
        const x = BELT_S[0] + (BELT_E[0] - BELT_S[0]) * u, y = BELT_S[1] + (BELT_E[1] - BELT_S[1]) * u + 0.065 * rise[1];
        const z = BELT_S[2] + (BELT_E[2] - BELT_S[2]) * u;
        const s = (0.016 + 0.014 * hash(i, 4)) * live * smooth(0, 0.06, u) * smooth(1, 0.94, u);
        dummy.position.set(x + (hash(i, 5) - 0.5) * 0.018, y, z + (hash(i, 6) - 0.5) * 0.018);
        dummy.rotation.set(i, i * 2.3, i * 0.7); dummy.scale.set(s * 1.2, s, s);
        dummy.updateMatrix(); om.setMatrixAt(i, dummy.matrix);
        if (i < 8) {
          const o = (GL.spark + i) * 3;
          gl.pos[o] = x; gl.pos[o + 1] = y + 0.02; gl.pos[o + 2] = z;
          const tw = Math.pow(Math.max(0, Math.sin(t * (2.2 + hash(i, 8) * 2) + i * 5.1)), 10);
          setCol(gl.col, GL.spark + i, v.spark); gl.kind[GL.spark + i] = 2;
          gl.size[GL.spark + i] = 0.11 * (0.4 + tw); gl.alpha[GL.spark + i] = (0.1 + tw) * v.sparkle * live * (world.reduced ? 0.6 : 1);
        }
      }
      om.instanceMatrix.needsUpdate = true;
    }
    // sparkles sitting on the piles
    for (let i = 0; i < 6; i++) {
      const px = [0.32, 0.22, -0.08, 0.58, 0.66, -0.55][i], pz = [-0.68, -0.7, -0.72, 0.14, -0.02, 0.5][i], ph = [0.13, 0.09, 0.1, 0.08, 0.06, 0.06][i];
      const o = (GL.pileSpark + i) * 3;
      gl.pos[o] = px + (hash(i, 11) - 0.5) * 0.06; gl.pos[o + 1] = ph * 0.55 * rise[1]; gl.pos[o + 2] = pz + 0.04;
      const tw = Math.pow(Math.max(0, Math.sin(t * (1.3 + hash(i, 12)) + i * 2.7)), 14);
      setCol(gl.col, GL.pileSpark + i, v.spark); gl.kind[GL.pileSpark + i] = 2;
      gl.size[GL.pileSpark + i] = 0.12 * (0.3 + tw); gl.alpha[GL.pileSpark + i] = tw * v.sparkle * (1 + 1.5 * night) * rise[1] * (world.reduced ? 0.7 : 1);
    }
    // haul trucks
    const tm = trucks.current;
    for (let k = 0; k < N_TRUCK; k++) {
      const c = world.reduced ? 3 + k * 9 : (t + k * (CYCLE / 2)) % CYCLE;
      let u: number, turn: number;
      if (c < 8) { u = smooth(0, 1, c / 8); turn = 0; }
      else if (c < 9) { u = 1; turn = smooth(0, 1, c - 8); }
      else if (c < 16.5) { u = 1 - smooth(0, 1, (c - 9) / 7.5); turn = 1; }
      else { u = 0; turn = 1 - smooth(0, 1, c - 16.5); }
      const phi = PHI * 0.97 * (1 - u), th = roadTh(phi), rr = roadR(phi) + (turn > 0.5 ? 0.02 : -0.02);
      const x = PIT.x + Math.cos(th) * rr, z = PIT.z + Math.sin(th) * rr, y = roadH(phi) + 0.028;
      // heading while climbing = -dP/dphi
      const hx = 0.35 / PHI * Math.cos(th) - roadR(phi) * Math.sin(th), hz = 0.35 / PHI * Math.sin(th) + roadR(phi) * Math.cos(th);
      const yaw = Math.atan2(hx, hz) + Math.PI * turn;
      const sc = vis;
      dummy.position.set(x, y * rise[0], z); dummy.rotation.set(0, yaw, 0); dummy.scale.set(sc, sc, sc);
      dummy.updateMatrix();
      tm?.setMatrixAt(k, dummy.matrix);
      const fwx = Math.sin(yaw), fwz = Math.cos(yaw);
      for (let s = 0; s < 2; s++) {
        const idx = GL.head + k * 2 + s, o = idx * 3, side = s ? 0.025 : -0.025;
        gl.pos[o] = x + fwx * 0.085 + fwz * side; gl.pos[o + 1] = y * rise[0] + 0.04; gl.pos[o + 2] = z + fwz * 0.085 - fwx * side;
        setCol(gl.col, idx, 0xfff3d0); gl.size[idx] = 0.075; gl.alpha[idx] = (0.25 + 0.75 * night) * vis; gl.kind[idx] = 1;
      }
      for (let b = 0; b < 4; b++) {
        const idx = GL.beam + k * 4 + b, o = idx * 3, d = 0.11 + b * 0.075;
        gl.pos[o] = x + fwx * d; gl.pos[o + 1] = y * rise[0] + 0.03 - b * 0.004; gl.pos[o + 2] = z + fwz * d;
        setCol(gl.col, idx, 0xfff0c0); gl.kind[idx] = 1; gl.size[idx] = 0.07 + b * 0.04; gl.alpha[idx] = (0.06 + 0.3 * night) * vis * (1 - b * 0.18);
      }
    }
    if (tm) tm.instanceMatrix.needsUpdate = true;
    // dust drifting from the crusher and, during the build, from the digging pit
    for (let i = 0; i < 12; i++) {
      const life = ((t * 0.22 + hash(i, 21)) % 1), o = (GL.dust + i) * 3;
      const ox = i < 8 ? BELT_E[0] + 0.05 : PIT.x, oz = i < 8 ? BELT_E[2] + 0.02 : PIT.z;
      gl.pos[o] = ox + (hash(i, 22) - 0.5) * 0.12 + life * 0.12; gl.pos[o + 1] = (i < 8 ? 0.2 : 0.06) + life * 0.28 * (i < 8 ? 1 : 0.5); gl.pos[o + 2] = oz + (hash(i, 23) - 0.5) * 0.08;
      setCol(gl.col, GL.dust + i, v.strata[3], 1.1); gl.kind[GL.dust + i] = 0;
      gl.size[GL.dust + i] = 0.08 + life * 0.16; gl.alpha[GL.dust + i] = (i < 8 ? 0.22 : 0.12) * Math.sin(life * Math.PI) * live * (world.reduced ? 0.5 : 1);
    }
    for (let i = 0; i < 12; i++) {
      const o = (GL.buildDust + i) * 3, life = clamp01((a - 0.1 - hash(i, 31) * 0.5) / 1.1);
      const ang = hash(i, 32) * 6.283, rad = 0.1 + life * 0.5;
      gl.pos[o] = PIT.x + Math.cos(ang) * rad; gl.pos[o + 1] = 0.05 + life * 0.35; gl.pos[o + 2] = PIT.z + Math.sin(ang) * rad;
      setCol(gl.col, GL.buildDust + i, v.strata[4], 1.2); gl.kind[GL.buildDust + i] = 0;
      gl.size[GL.buildDust + i] = 0.1 + life * 0.25; gl.alpha[GL.buildDust + i] = life > 0 && life < 1 ? 0.5 * Math.sin(life * Math.PI) : 0;
    }
    // night extras: light cones, pools on the pit, road lamps, truck beams, crusher mouth, more pile sparkle
    const nz = night * live;
    for (let i = 0; i < 3; i++) {
      const [fx, fz, h] = FLOODS[i];
      const tx = PIT.x + (i === 0 ? 0.05 : i === 1 ? 0.0 : 0.1), tz = PIT.z + (i === 0 ? 0.0 : i === 1 ? 0.05 : -0.05);
      for (let k = 0; k < 6; k++) {
        const idx = GL.cone + i * 6 + k, o = idx * 3, u = (k + 1) / 6.5;
        gl.pos[o] = fx + (tx - fx) * u; gl.pos[o + 1] = (h + (0.1 - h) * u) * rise[1]; gl.pos[o + 2] = fz + (tz - fz) * u;
        setCol(gl.col, idx, 0xffe6b0); gl.kind[idx] = 1; gl.size[idx] = 0.12 + u * 0.32; gl.alpha[idx] = 0.16 * nz * (1 - 0.5 * u);
      }
      const pi = GL.pitPool + i, po = pi * 3;
      gl.pos[po] = tx; gl.pos[po + 1] = 0.12 * rise[0]; gl.pos[po + 2] = tz;
      setCol(gl.col, pi, 0xffc878); gl.kind[pi] = 1; gl.size[pi] = 0.75; gl.alpha[pi] = 0.22 * nz * rise[0];
    }
    for (let i = 0; i < N_RL; i++) {
      const phi = ((i + 0.5) / N_RL) * PHI * 0.96, th = roadTh(phi), r = roadR(phi) + 0.062, idx = GL.roadLamp + i, o = idx * 3;
      gl.pos[o] = PIT.x + Math.cos(th) * r; gl.pos[o + 1] = (roadH(phi) + 0.04) * rise[0]; gl.pos[o + 2] = PIT.z + Math.sin(th) * r;
      setCol(gl.col, idx, 0xffd890); gl.kind[idx] = 1; gl.size[idx] = 0.075; gl.alpha[idx] = (0.15 + 0.85 * night) * live * rise[0];
    }
    gl.pos[GL.mouth * 3] = BELT_E[0]; gl.pos[GL.mouth * 3 + 1] = 0.33 * rise[1]; gl.pos[GL.mouth * 3 + 2] = BELT_E[2];
    setCol(gl.col, GL.mouth, 0xff9a40); gl.kind[GL.mouth] = 1; gl.size[GL.mouth] = 0.3; gl.alpha[GL.mouth] = (0.3 + 0.55 * night) * live * (0.85 + 0.15 * Math.sin(t * 7));
    gl.pos[(GL.mouth + 1) * 3] = HEADFRAME.x; gl.pos[(GL.mouth + 1) * 3 + 1] = 0.3 * rise[2]; gl.pos[(GL.mouth + 1) * 3 + 2] = HEADFRAME.z + 0.2;
    setCol(gl.col, GL.mouth + 1, 0xffd27a); gl.kind[GL.mouth + 1] = 1; gl.size[GL.mouth + 1] = 0.3; gl.alpha[GL.mouth + 1] = 0.35 * nz;
    for (let i = 0; i < 8; i++) {
      const idx = GL.spark2 + i, o = idx * 3, pi = i % 6;
      const px = [0.32, 0.22, -0.08, 0.58, 0.66, -0.55][pi], pz = [-0.68, -0.7, -0.72, 0.14, -0.02, 0.5][pi], ph = [0.13, 0.09, 0.1, 0.08, 0.06, 0.06][pi];
      gl.pos[o] = px + (hash(i, 71) - 0.5) * 0.14; gl.pos[o + 1] = ph * (0.2 + 0.5 * hash(i, 72)) * rise[1]; gl.pos[o + 2] = pz + (hash(i, 73) - 0.3) * 0.1;
      const tw = Math.pow(Math.max(0, Math.sin(t * (1.7 + hash(i, 74) * 1.5) + i * 3.3)), 8);
      setCol(gl.col, idx, v.spark); gl.kind[idx] = 2; gl.size[idx] = 0.14 * (0.3 + tw); gl.alpha[idx] = tw * v.sparkle * (0.3 + 1.4 * night) * rise[1] * (world.reduced ? 0.6 : 1);
    }
    gl.dirty();
    // sheave wheel: spins up during the build
    const wh = wheelRef.current;
    if (wh) {
      const s = easeOutBack(ramp(a, 1.35, 0.5));
      wh.scale.setScalar(Math.max(0.001, s));
      wh.rotation.x = world.reduced ? 0.4 : t * 1.6 + 14 * (1 - easeOutCubic(ramp(a, 1.35, 1.6)));
      wh.position.set(HEADFRAME.x, 0.93 * rise[2], HEADFRAME.z);
    }
    if (root.current) root.current.visible = true;
  });

  return (
    <group ref={root} position={[0, p.top, 0]} scale={[p.radius * mirror, p.radius, p.radius]}>
      <mesh geometry={geo.body} material={bodyM.mat} />
      <mesh geometry={geo.lit} material={litM.mat} />
      <mesh ref={wheelRef} geometry={geo.wheel} material={wheelMat} />
      <instancedMesh ref={ore} args={[chunk, oreMat, N_CHUNK]} frustumCulled={false} />
      <instancedMesh ref={trucks} args={[geo.truck, truckMat, N_TRUCK]} frustumCulled={false} />
      <primitive object={glow.points} />
    </group>
  );
}
