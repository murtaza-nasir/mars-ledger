// Detailed Commercial District: a vivid trading hub. Eight glass towers (twin spires, stepped, cylinder with helipad,
// slanted, octagonal, terraced, obelisk) with reflective glass, lit windows and neon edge strips; abstract-glyph neon signs
// and holographic billboards with scan lines, a rotating hologram globe over the plaza fountain, a shopping arcade with
// awnings, neon trees, hundreds of dot people, sky-bridges with shuttling pods, air taxis and drones on loops.
// Build-in: the plaza lights, the towers rise one by one, the neon flickers on, the hologram wakes, the traffic starts.
// detail='lite' keeps the same layout in <= 6 draw calls.
import {useFrame, useThree} from '@react-three/fiber';
import {useEffect, useMemo, useRef} from 'react';
import * as THREE from 'three';
import {PLAYER_HEX} from '../../../../../../shared/game';
import {seeded, world} from '../../tiles3d';
import type {ModelMeta, ModelProps} from '../contract';
import {clamp01, easeOutBack, easeOutCubic, hash, lampPatch, makeGlow, ramp, riseMaterial, setCol, setGlowScale, timeU} from '../MineKit';
import {commercialTextures, glassPatch, globeMaterial, holoMaterial, waterMaterial} from './CommercialTex';
import {BEACONS, BRIDGES, GLOBE, HOLOS, NEON, N_DRONE, N_POD, N_TAXI, PLAZA, SL, TOWERS, buildCommercial, type ComGeo} from './CommercialParts';

export const meta: ModelMeta = {set: 'detailed', name: 'Commercial District', tileTypes: [4], kind: 'special', buildSeconds: 3.4};

const built = new Map<string, ComGeo>();
function build(owner: number, full: boolean) {
  const key = `${owner}|${full}`;
  let b = built.get(key);
  if (!b) {
    b = buildCommercial(owner, full); built.set(key, b);
    const tc = (g: THREE.BufferGeometry) => Math.round((g.index ? g.index.count : g.attributes.position?.count ?? 0) / 3);
    const w = globalThis as unknown as {__detailedStats?: Record<string, unknown>};
    w.__detailedStats = {...(w.__detailedStats ?? {}), [`com-${full ? 'full' : 'lite'}`]: {body: tc(b.body), towers: tc(b.towers), lit: tc(b.lit), signs: tc(b.signs), water: tc(b.water), taxi: tc(b.taxi), drone: tc(b.drone)}};
  }
  return b;
}

const GLN = {halo: 8, holoHalo: 6, spire: 10, column: 8, plaza: 3, spark: 10, taxi: 6, taxiGlow: 3, drone: 16, people: 140, drops: 24, jets: 4, lamp: 8, tree: 6, shop: 5, pod: 5, globe: 2, pool: 4};
const GL: Record<string, number> = {}; let acc = 0;
for (const k of Object.keys(GLN) as Array<keyof typeof GLN>) { GL[k] = acc; acc += GLN[k]; }
const GL_N = acc;
const gp = (gl: ReturnType<typeof makeGlow>, i: number, x: number, y: number, z: number, hex: number, size: number, alpha: number, kind: number, k = 1) => {
  const o = i * 3; gl.pos[o] = x; gl.pos[o + 1] = y; gl.pos[o + 2] = z; setCol(gl.col, i, hex, k); gl.size[i] = size; gl.alpha[i] = alpha; gl.kind[i] = kind;
};
const dummy = new THREE.Object3D(); dummy.rotation.order = 'YXZ';
const TAXI = [
  {cx: 0, cz: -0.05, ra: 0.55, rb: 0.5, y: 0.86, wy: 0.16, sp: 0.18, ph: 0},
  {cx: 0.05, cz: 0.12, ra: 0.5, rb: 0.3, y: 0.52, wy: 0.1, sp: -0.22, ph: 2},
  {cx: -0.1, cz: -0.28, ra: 0.42, rb: 0.24, y: 1.02, wy: 0.12, sp: 0.14, ph: 4},
];
const DR = Array.from({length: N_DRONE}, (_, k) => ({cx: (hash(k, 1) - 0.5) * 0.8, cz: -0.05 + (hash(k, 2) - 0.5) * 0.7, ra: 0.1 + hash(k, 3) * 0.22, sp: (0.3 + hash(k, 4) * 0.4) * (k % 2 ? 1 : -1), y: 0.3 + hash(k, 5) * 0.65, ph: hash(k, 6) * 6.28}));
const PEOPLE = Array.from({length: 140}, (_, k) => ({kind: k % 5 === 4 ? 2 : k % 5 < 2 ? 0 : 1, ph: hash(k, 91) * 6.283, a: 0.18 + hash(k, 92) * 0.26, b: 0.15 + hash(k, 93) * 0.26, sp: (0.05 + hash(k, 94) * 0.1) * (hash(k, 95) > 0.5 ? 1 : -1), c: [0xff6a8a, 0x6ae8ff, 0xffd23a, 0xa08aff, 0x6affb0, 0xff9a4a, 0xffffff, 0x9ad0ff][k % 8]}));
const flick = (a: number, t0: number, i: number) => {
  const f = a - t0;
  if (f < 0) return 0;
  if (f < 0.45) return Math.sin(f * 90) + Math.sin(f * 53 + i) > -0.2 ? 1 : 0.1;
  return 1;
};

export default function CommercialDistrict(p: ModelProps) {
  const full = p.detail !== 'lite';
  const owner = p.color && PLAYER_HEX[p.color] ? parseInt(PLAYER_HEX[p.color].slice(1), 16) : 0xffc86a;
  const mirror = useMemo(() => (seeded(p.id)() < 0.5 ? -1 : 1), [p.id]);
  const geo = useMemo(() => build(owner, full), [owner, full]);
  const tx = useMemo(() => commercialTextures(), []);
  const lampP = useMemo(() => {
    const l = lampPatch(8);
    l.lamps.set([PLAZA.x, 0.08, PLAZA.z, 0.55, -0.3, 0.06, 0.6, 0.35, -0.1, 0.06, 0.6, 0.35, 0.1, 0.06, 0.6, 0.35, 0.3, 0.06, 0.6, 0.35, -0.45, 0.1, -0.3, 0.4, 0.45, 0.1, -0.3, 0.4, 0.0, 0.1, -0.1, 0.4]);
    return l;
  }, []);
  const uNight = useMemo(() => ({value: 0}), []);
  const glass = useMemo(() => glassPatch(uNight), [uNight]);
  const bodyM = useMemo(() => riseMaterial(new THREE.MeshStandardMaterial({vertexColors: true, map: tx.grunge, color: new THREE.Color(1.5, 1.5, 1.5), roughness: 0.6, metalness: 0.1}), 'com-d-body', lampP.extra), [tx, lampP]);
  const rise = bodyM.rise;
  const towerM = useMemo(() => riseMaterial(new THREE.MeshStandardMaterial({vertexColors: true, map: tx.facade, emissiveMap: tx.emissive, emissive: 0xffffff, emissiveIntensity: 0.05, roughness: 0.3, metalness: 0.25, color: new THREE.Color(1.15, 1.15, 1.15)}), 'com-d-tower', glass.extra, rise), [tx, glass, rise]);
  const onL = useMemo(() => new Float32Array(16), []);
  const litM = useMemo(() => riseMaterial(new THREE.MeshBasicMaterial({vertexColors: true}), 'com-d-lit', (s) => {
    s.uniforms.uOn = {value: onL};
    s.fragmentShader = 'uniform float uOn[16]; uniform float uTime; varying float vGrp; varying vec3 vLocal;\n' + s.fragmentShader.replace('#include <color_fragment>',
      `#include <color_fragment>
      float onv = uOn[int(vGrp + 0.5)];
      float pulse = 0.8 + 0.35 * smoothstep(0.92, 1.0, sin(vLocal.y * 7.0 - uTime * 3.0 + vGrp));
      diffuseColor.rgb *= onv * pulse;`);
  }, rise), [rise, onL]);
  const holo = useMemo(() => holoMaterial(tx.atlas), [tx]);
  const globe = useMemo(() => globeMaterial(), []);
  const water = useMemo(() => waterMaterial(), []);
  const veh = useMemo(() => new THREE.MeshStandardMaterial({vertexColors: true, roughness: 0.5, metalness: 0.2, color: new THREE.Color(1.3, 1.3, 1.3), emissive: 0x303a60}), []);
  const glow = useMemo(() => makeGlow(GL_N), []);
  const taxis = useRef<THREE.InstancedMesh>(null), drones = useRef<THREE.InstancedMesh>(null), pods = useRef<THREE.InstancedMesh>(null), globeRef = useRef<THREE.Mesh>(null);
  const {camera} = useThree();
  useEffect(() => () => { bodyM.mat.dispose(); towerM.mat.dispose(); litM.mat.dispose(); holo.mat.dispose(); globe.mat.dispose(); water.mat.dispose(); veh.dispose(); glow.points.geometry.dispose(); }, [bodyM, towerM, litM, holo, globe, water, veh, glow]);

  useFrame((state) => {
    const t = world.t, night = p.night, a = world.reduced ? 99 : p.age();
    timeU.value = t;
    setGlowScale(state.size.height * state.gl.getPixelRatio(), (camera as THREE.PerspectiveCamera).fov ?? 40);
    uNight.value = night; glass.uRefl.value = 1;
    for (let i = 0; i < 8; i++) rise[i] = easeOutCubic(ramp(a, 0.2 + i * 0.12, 0.85));
    rise[8] = easeOutBack(ramp(a, 0, 0.5)); rise[9] = easeOutBack(ramp(a, 0.9, 0.6)); rise[10] = easeOutBack(ramp(a, 1.0, 0.6));
    lampP.uLit.value = night * (0.4 + 0.6 * ramp(a, 1.5, 0.8));
    towerM.mat.emissiveIntensity = 0.04 + 1.0 * night;
    veh.emissiveIntensity = 0.3 + 0.7 * night;
    water.uNight.value = night; water.uRing.value.setHex(owner).multiplyScalar(0.7);
    const gl = glow;
    for (let i = 0; i < GL_N; i++) gl.alpha[i] = 0;
    // neon: each group flickers on (towers 0..7, plaza 8, shops 9, props 10), the signs and the hologram follow
    for (let g = 0; g < 11; g++) {
      const t0 = g < 8 ? 1.3 + g * 0.1 : g === 8 ? 0.6 : g === 9 ? 1.9 : 1.7;
      let v = flick(a, t0, g);
      if (!world.reduced && v === 1 && hash(Math.floor(t * 6) + g * 7, 19) > 0.985) v = 0.3;
      onL[g] = v * (0.55 + 0.45 * night);
    }
    const on = holo.on;
    for (let i = 0; i < 14; i++) {
      let v = flick(a, i < 8 ? 1.3 + i * 0.1 : 2.1 + (i - 8) * 0.12, i + 3);
      if (!world.reduced && v === 1 && hash(Math.floor(t * 6) + i * 7, 29) > 0.985) v = 0.3;
      on[i] = v * (0.65 + 0.35 * night);
    }
    const hg = globeRef.current;
    if (hg) {
      const gOn = flick(a, 2.3, 9) * (0.55 + 0.45 * night);
      globe.uOn.value = gOn;
      hg.position.set(GLOBE.x, GLOBE.y + 0.012 * Math.sin(t * 1.2), GLOBE.z); hg.rotation.y = world.reduced ? 0.4 : t * 0.6; hg.rotation.z = 0.25;
      hg.scale.setScalar(Math.max(0.001, easeOutBack(ramp(a, 2.3, 0.6))));
    }
    // halos behind the signs and holograms
    for (let i = 0; i < 8; i++) {
      const tw = TOWERS[i], r = rise[i];
      gp(gl, GL.halo + i, tw.x, tw.h * (0.5 + 0.1 * hash(i, 1)), tw.z + tw.d / 2 + 0.03, NEON[i % NEON.length], 0.22, on[i] * (0.14 + 0.28 * night) * (r > 0.99 ? 1 : 0), 1);
    }
    for (let i = 0; i < 6; i++) {
      const h = HOLOS[i];
      gp(gl, GL.holoHalo + i, h.x, h.y + 0.014 * Math.sin(t * 1.3 + (8 + i) * 2), h.z - 0.02, h.col, 0.42, on[8 + i] * (0.1 + 0.26 * night), 1);
    }
    // beacons on the spires: blinking owner / red lights, placed where the geometry's spheres sit
    for (let i = 0; i < Math.min(BEACONS.length, GLN.spire); i++) {
      const bc = BEACONS[i], r = rise[bc.tower];
      gp(gl, GL.spire + i, bc.x, bc.y * r, bc.z, bc.c === 0xff3030 ? 0xff3030 : owner, 0.2, (0.5 + 0.5 * night) * (0.5 + 0.5 * Math.max(0, Math.sin(t * 2.6 + i * 1.7))) * clamp01(r * 1.5), 1);
    }
    // plaza: light column, owner pool, fountain glow
    const px = PLAZA.x, pz = PLAZA.z, r8 = clamp01(rise[8]);
    for (let i = 0; i < 8; i++) {
      const u = (t * 0.35 + i / 8) % 1;
      gp(gl, GL.column + i, px, SL + 0.22 + u * 0.5, pz, i % 2 ? 0x31e8ff : owner, 0.16 + 0.1 * (1 - u), (0.14 + 0.28 * night) * (1 - u) * r8 * (world.reduced ? 0.6 : 1), 1);
    }
    gp(gl, GL.plaza, px, SL + 0.03, pz, owner, 0.9, (0.12 + 0.26 * night) * r8, 1);
    gp(gl, GL.plaza + 1, px, SL + 0.04, pz, 0x31e8ff, 0.55, (0.08 + 0.18 * night) * r8, 1);
    gp(gl, GL.plaza + 2, GLOBE.x, GLOBE.y, GLOBE.z, 0x6ae8ff, 0.3, (0.1 + 0.3 * night) * flick(a, 2.3, 9), 1);
    for (let i = 0; i < 4; i++) { const ang = i * 1.57; gp(gl, GL.pool + i, px + Math.cos(ang) * 0.3, SL + 0.03, pz + Math.sin(ang) * 0.3, i % 2 ? 0xff3aa8 : 0x31e8ff, 0.5, 0.1 * night * r8, 1); }
    // sparkles across the glass
    for (let i = 0; i < (full ? 10 : 4); i++) {
      const tw = TOWERS[i % 5], ph = (t * 0.7 + hash(i, 61) * 5) % 4, tws = Math.pow(Math.max(0, Math.sin(ph * 1.57)), 20);
      gp(gl, GL.spark + i, tw.x + (hash(i, 62) - 0.5) * tw.w, tw.h * (0.3 + 0.65 * hash(i, 63)) * rise[i % 5], tw.z + tw.d / 2 + 0.01, 0xdff4ff, 0.1 * (0.3 + tws), tws * (0.35 + 0.35 * night) * clamp01(rise[i % 5] * 1.2) * (world.reduced ? 0.6 : 1), 2);
    }
    // lamps, trees, shop windows
    if (full) {
      for (let i = 0; i < 8; i++) { const ang = (i / 8) * 6.283 + 0.4; gp(gl, GL.lamp + i, px + Math.cos(ang) * 0.34, SL + 0.1, pz + Math.sin(ang) * 0.34, i % 2 ? 0xff9ad8 : 0x9affea, 0.09, (0.2 + 0.8 * night) * clamp01(rise[10]), 1); }
      for (let i = 0; i < 6; i++) { const ang = (i / 6) * 6.283 + 0.5; gp(gl, GL.tree + i, px + Math.cos(ang) * 0.4, SL + 0.082, pz + Math.sin(ang) * 0.38, i % 2 ? 0x9a6aff : 0x4affc8, 0.12, (0.15 + 0.5 * night) * clamp01(rise[10]), 1); }
    }
    for (let i = 0; i < 5; i++) { const x = -0.46 + i * 0.23; gp(gl, GL.shop + i, x, SL + 0.05, 0.62 - Math.abs(x) * 0.12 + 0.07, [0xffd9a0, 0xff9ad8, 0x9affea, 0xffe07a, 0xb0a0ff][i], 0.3, (0.07 + 0.22 * night) * clamp01(rise[9]), 1); }
    // fountain: droplets on arcs and bright jets
    const nDrop = full ? 24 : 8;
    for (let i = 0; i < nDrop; i++) {
      const per = 1.3, ph = ((world.reduced ? 0.3 : t) * 0.9 + hash(i, 71) * per) % per, ang = hash(i, 72) * 6.283, v = 0.07 + 0.05 * hash(i, 73);
      const rr = v * ph * 0.9;
      gp(gl, GL.drops + i, px + Math.cos(ang) * rr, SL + 0.14 + 0.2 * ph - 0.22 * ph * ph, pz + Math.sin(ang) * rr, 0xbfefff, 0.03, 0.8 * (1 - ph / per) * r8 * (world.reduced ? 0.5 : 1), 1);
    }
    for (let i = 0; i < GLN.jets; i++) { const u = (t * 1.1 + i * 0.25) % 1; gp(gl, GL.jets + i, px, SL + 0.14 + u * 0.1, pz, 0xe8fbff, 0.05, 0.6 * (1 - u) * r8, 1); }
    // dot people: ring walkers, free wanderers and arcade shoppers
    const nPeople = full ? 140 : 40, pv = clamp01((a - 1.6) / 0.8);
    for (let k = 0; k < nPeople; k++) {
      const q = PEOPLE[k], ang = (world.reduced ? 0 : t) * q.sp + q.ph;
      let x: number, z: number;
      if (q.kind === 0) { const rr = 0.18 + (q.a - 0.18) * 0.9; x = px + Math.cos(ang) * (0.17 + rr * 0.8); z = pz + Math.sin(ang) * (0.15 + rr * 0.7); }
      else if (q.kind === 1) { x = px + Math.sin(ang * 1.7 + q.ph) * q.a * 1.15; z = pz + Math.sin(ang * 1.3) * q.b * 0.9; if (Math.hypot(x - px, z - pz) < 0.15) { x = px + (x - px) * 1.9; z = pz + (z - pz) * 1.9; } }
      else { x = Math.sin(ang * 1.2 + q.ph) * 0.45; z = 0.57 - Math.abs(x) * 0.1 + 0.015 * Math.sin(ang * 5); }
      const bob = 0.002 * Math.sin(t * 6 + k);
      gp(gl, GL.people + k, x, SL + 0.01 + bob, z, q.c, 0.013, 0.9 * pv * (0.8 + 0.2 * night) * rise[8], 0, 1 + 0.6 * night);
    }
    // air taxis, drones, pods
    const live = easeOutBack(ramp(a, 2.4, 0.6)), tm = taxis.current, dm = drones.current, pm = pods.current;
    const nT = full ? N_TAXI : N_TAXI + 3;
    for (let k = 0; k < nT; k++) {
      const q = k < N_TAXI ? TAXI[k] : DR[k - N_TAXI], isT = k < N_TAXI;
      const ang = world.reduced ? q.ph : t * q.sp + q.ph, sg = Math.sign(q.sp);
      const ra = q.ra, rb = isT ? TAXI[k].rb : q.ra * 0.8;
      const x = q.cx + Math.cos(ang) * ra, z = q.cz + Math.sin(ang) * rb, y = (q.y + (isT ? TAXI[k].wy : 0.03) * Math.sin(ang * 2 + k)) * live;
      const hx = -Math.sin(ang) * ra * sg, hz = Math.cos(ang) * rb * sg;
      dummy.position.set(x, y, z); dummy.rotation.set(0.05 * Math.cos(ang * 2), Math.atan2(hx, hz), -sg * (isT ? 0.28 : 0.08)); dummy.scale.setScalar(Math.max(live, 0.001) * (isT ? 1 : 0.55));
      dummy.updateMatrix(); tm?.setMatrixAt(k, dummy.matrix);
      if (isT || full) {
        const i = GL.taxi + (isT ? k * 2 : 0), blink = Math.max(0, Math.sin(t * 4.5 + k * 2) * 3);
        const fx = Math.cos(Math.atan2(hx, hz)) * 0.045, fz = -Math.sin(Math.atan2(hx, hz)) * 0.045;
        if (isT) {
          gp(gl, i, x + fx, y + 0.012, z + fz, 0xff3030, 0.07, clamp01(blink) * live * (0.5 + 0.5 * night), 1);
          gp(gl, i + 1, x - fx, y + 0.012, z - fz, 0x50ff90, 0.07, live * (0.5 + 0.5 * night), 1);
          gp(gl, GL.taxiGlow + k, x, y - 0.008, z, 0x31e8ff, 0.16, (0.3 + 0.6 * night) * live, 1);
        }
      }
    }
    if (tm) tm.instanceMatrix.needsUpdate = true;
    if (dm) {
      for (let k = 0; k < N_DRONE; k++) {
        const d = DR[k], ang = world.reduced ? d.ph : t * d.sp + d.ph;
        const x = d.cx + Math.cos(ang) * d.ra, z = d.cz + Math.sin(ang) * d.ra * 0.8, y = (d.y + 0.03 * (world.reduced ? 0 : Math.sin(t * 1.7 + k))) * live;
        dummy.position.set(x, y, z); dummy.rotation.set(Math.cos(ang) * 0.12, -ang, -Math.sin(ang) * 0.12); dummy.scale.setScalar(Math.max(live, 0.001));
        dummy.updateMatrix(); dm.setMatrixAt(k, dummy.matrix);
        for (let s = 0; s < 2; s++) {
          const i = GL.drone + k * 2 + s, blink = s ? Math.max(0, Math.sin(t * 4.5 + k * 2) * 3) : (Math.sin(t * 2.2 + k) > 0.6 ? 1 : 0.15);
          gp(gl, i, x + (s ? 0.022 : -0.022), y + 0.012, z + 0.018, s ? 0xff3030 : 0x50ff90, 0.06, clamp01(blink) * live * (0.5 + 0.5 * night), 1);
        }
      }
      dm.instanceMatrix.needsUpdate = true;
    }
    if (pm) {
      for (let b = 0; b < N_POD; b++) {
        const [ia, ib, by] = BRIDGES[b], A = TOWERS[ia], Bt = TOWERS[ib], u = 0.5 + 0.36 * Math.sin((world.reduced ? 0 : t) * 0.35 + b * 1.7);
        const rr = rise[Math.max(ia, ib)];
        dummy.position.set(A.x + (Bt.x - A.x) * u, (by + 0.0) * rr, A.z + (Bt.z - A.z) * u); dummy.rotation.set(0, Math.atan2(Bt.x - A.x, Bt.z - A.z), 0); dummy.scale.setScalar(Math.max(rr, 0.001));
        dummy.updateMatrix(); pm.setMatrixAt(b, dummy.matrix);
        gp(gl, GL.pod + b, A.x + (Bt.x - A.x) * u, (by + 0.01) * rr, A.z + (Bt.z - A.z) * u, 0xbfe8ff, 0.1, (0.2 + 0.5 * night) * clamp01(rr), 1);
      }
      pm.instanceMatrix.needsUpdate = true;
    }
    gl.dirty();
  });

  return (
    <group position={[0, p.top, 0]} scale={[p.radius * mirror, p.radius, p.radius]}>
      <mesh geometry={geo.body} material={bodyM.mat} />
      <mesh geometry={geo.towers} material={towerM.mat} />
      <mesh geometry={geo.lit} material={litM.mat} />
      <mesh geometry={geo.signs} material={holo.mat} renderOrder={5} />
      <instancedMesh ref={taxis} args={[geo.taxi, veh, full ? N_TAXI : N_TAXI + 3]} frustumCulled={false} />
      {full && (
        <>
          <instancedMesh ref={drones} args={[geo.drone, veh, N_DRONE]} frustumCulled={false} />
          <instancedMesh ref={pods} args={[geo.pod, veh, N_POD]} frustumCulled={false} />
          <mesh geometry={geo.water} material={water.mat} position={[PLAZA.x, 0, PLAZA.z]} />
          <mesh ref={globeRef} geometry={geo.globe} material={globe.mat} renderOrder={6} frustumCulled={false} />
        </>
      )}
      <primitive object={glow.points} />
    </group>
  );
}
