// Commercial District: a dense trading plaza. Glass towers with lit windows, abstract neon glyph signs (no real
// text), shimmering holographic billboards, sky-bridges with glowing strips, a lit plaza with an owner-coloured ring
// and light column, and drones with blinking lights. Build-in: the plaza lights, the towers rise one by one, then
// the neon signs flicker on sign by sign and the drones take off.
import {useFrame, useThree} from '@react-three/fiber';
import {useEffect, useMemo, useRef} from 'react';
import * as THREE from 'three';
import {PLAYER_HEX} from '../../../../../shared/game';
import {seeded, world} from '../tiles3d';
import type {ModelMeta, ModelProps} from './contract';
import {Builder, G, clamp01, easeOutBack, easeOutCubic, hash, makeGlow, ramp, riseMaterial, setCol, setGlowScale, timeU, triCount} from './MineKit';

export const meta: ModelMeta = {name: 'Commercial District', tileTypes: [4], kind: 'special', buildSeconds: 2.4};

type Tower = {x: number; z: number; w: number; d: number; h: number; tint: number; spire?: number};
const TOWERS: Tower[] = [
  {x: -0.52, z: -0.44, w: 0.24, d: 0.24, h: 1.4, tint: 0x5f7aa8, spire: 0.28},
  {x: -0.1, z: -0.62, w: 0.22, d: 0.2, h: 1.15, tint: 0x6a6aa6},
  {x: 0.32, z: -0.52, w: 0.26, d: 0.24, h: 1.28, tint: 0x4f8a9a, spire: 0.22},
  {x: 0.64, z: -0.12, w: 0.2, d: 0.2, h: 0.92, tint: 0x8a6a9a},
  {x: -0.68, z: 0.02, w: 0.2, d: 0.22, h: 0.86, tint: 0x5a8a8a},
  {x: 0.58, z: 0.34, w: 0.18, d: 0.18, h: 0.56, tint: 0x6a7ab0},
  {x: -0.56, z: 0.4, w: 0.18, d: 0.18, h: 0.5, tint: 0x8a7a6a},
  {x: 0.02, z: -0.22, w: 0.18, d: 0.18, h: 0.74, tint: 0x6a8ab0},
];
const PLAZA = {x: 0.02, z: 0.2};
const NEON = [0xff3aa8, 0x31e8ff, 0xffd23a, 0x7a5cff, 0x4aff9a, 0xff7a3a, 0x31e8ff, 0xff3aa8];
const HOLOS: Array<{x: number; y: number; z: number; w: number; h: number; yaw: number; col: number}> = [
  {x: 0.02, y: 0.5, z: 0.3, w: 0.3, h: 0.18, yaw: 0, col: 0x6ae8ff},
  {x: -0.4, y: 0.36, z: 0.18, w: 0.2, h: 0.13, yaw: 0.6, col: 0xff8ad8},
  {x: 0.44, y: 0.42, z: 0.12, w: 0.2, h: 0.13, yaw: -0.6, col: 0xffe07a},
  {x: 0.02, y: 0.96, z: -0.3, w: 0.26, h: 0.16, yaw: 0, col: 0x9a8aff},
];
const N_DRONE = 6;

// ---- textures (made lazily; the browser only) -------------------------------------------------------------
type Tex = {facade: THREE.CanvasTexture; emissive: THREE.CanvasTexture; atlas: THREE.CanvasTexture};
let texs: Tex | null = null;
function textures(): Tex {
  if (texs) return texs;
  const mk = (w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat: boolean, srgb = true) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d')!);
    const t = new THREE.CanvasTexture(c);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
    t.anisotropy = 4;
    return t;
  };
  const CELL = 32, N = 8;
  const facade = mk(256, 256, (g) => {
    g.fillStyle = '#c6cad6'; g.fillRect(0, 0, 256, 256);
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      g.fillStyle = '#16203a'; g.fillRect(c * CELL + 4, r * CELL + 6, CELL - 8, CELL - 12);
      g.fillStyle = 'rgba(160,190,230,0.35)'; g.fillRect(c * CELL + 4, r * CELL + 6, CELL - 8, 4);
    }
  }, true);
  const warm = ['#ffd9a0', '#ffe9c0', '#9fd8ff', '#ffb0e0', '#b8ffd8'];
  const emissive = mk(256, 256, (g) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, 256, 256);
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const h = hash(r * 11 + c, 77);
      if (h < 0.5) continue;
      g.fillStyle = warm[Math.floor(hash(r * 7 + c, 78) * warm.length) % (h > 0.93 ? warm.length : 2)];
      g.fillRect(c * CELL + 5, r * CELL + 8, CELL - 10, CELL - 16);
    }
  }, true);
  // atlas: 8 rows of 64 px: 0-3 neon glyph strips, 4-7 hologram panels
  const atlas = mk(512, 512, (g) => {
    g.clearRect(0, 0, 512, 512);
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (let row = 0; row < 4; row++) {
      g.save(); g.shadowColor = '#fff'; g.shadowBlur = 8; g.strokeStyle = '#fff'; g.fillStyle = '#fff'; g.lineWidth = 6;
      let x = 20;
      for (let k = 0; k < 8; k++) {
        const kind = Math.floor(hash(row * 9 + k, 5) * 6), cy = row * 64 + 32;
        g.beginPath();
        if (kind === 0) g.arc(x + 14, cy, 12, 0, 6.283);
        else if (kind === 1) { g.moveTo(x, cy + 14); g.lineTo(x + 14, cy - 14); g.lineTo(x + 28, cy + 14); g.closePath(); }
        else if (kind === 2) { g.rect(x, cy - 14, 8, 28); g.rect(x + 16, cy - 14, 8, 28); }
        else if (kind === 3) { g.moveTo(x, cy); g.lineTo(x + 14, cy - 14); g.lineTo(x + 28, cy); g.lineTo(x + 14, cy + 14); g.closePath(); }
        else if (kind === 4) { g.moveTo(x, cy + 10); g.lineTo(x + 9, cy - 10); g.lineTo(x + 18, cy + 10); g.lineTo(x + 28, cy - 10); }
        else { g.arc(x + 6, cy, 4, 0, 6.283); g.arc(x + 22, cy, 4, 0, 6.283); }
        if (kind === 2 || kind === 5) g.fill(); else g.stroke();
        x += 58;
      }
      g.restore();
    }
    for (let row = 4; row < 8; row++) for (let pn = 0; pn < 4; pn++) {
      const y0 = row * 64, x0 = pn * 128;
      const grad = g.createLinearGradient(0, y0, 0, y0 + 64); grad.addColorStop(0, 'rgba(255,255,255,0.4)'); grad.addColorStop(1, 'rgba(255,255,255,0.12)');
      g.fillStyle = grad; g.fillRect(x0 + 3, y0 + 3, 122, 58);
      g.strokeStyle = 'rgba(255,255,255,0.95)'; g.lineWidth = 3; g.strokeRect(x0 + 4, y0 + 4, 120, 56);
      g.fillStyle = 'rgba(255,255,255,0.9)';
      for (let k = 0; k < 5; k++) { const hh = 8 + hash(row * 13 + k + pn * 3, 9) * 30; g.fillRect(x0 + 12 + k * 11, y0 + 54 - hh, 7, hh); }
      g.lineWidth = 4; g.beginPath(); g.arc(x0 + 90, y0 + 22, 11, 0, 3.5 + hash(row + pn, 4) * 2.4); g.stroke();
      g.lineWidth = 3; g.beginPath(); g.moveTo(x0 + 70, y0 + 52); for (let k = 0; k < 4; k++) g.lineTo(x0 + 70 + k * 15, y0 + 34 + hash(row * 5 + k + pn, 3) * 18); g.stroke();
      g.lineWidth = 1; g.strokeStyle = 'rgba(255,255,255,0.5)';
      for (let k = 0; k < 5; k++) { g.beginPath(); g.moveTo(x0 + 8, y0 + 10 + k * 10); g.lineTo(x0 + 120, y0 + 10 + k * 10); g.stroke(); }
    }
  }, false);
  texs = {facade, emissive, atlas};
  return texs;
}

// ---- geometry -------------------------------------------------------------------------------------------------
type Built = {body: THREE.BufferGeometry; lit: THREE.BufferGeometry; signs: THREE.BufferGeometry; drone: THREE.BufferGeometry; tris: number};
const built = new Map<number, Built>();

function quad(pos: number[], uv: number[], col: number[], grp: number[], idx: number[], cx: number, cy: number, cz: number, w: number, h: number, yaw: number, roll: number, row: number, color: number, u0 = 0, uw = 1) {
  const base = pos.length / 3, c = new THREE.Color(color);
  const cs = Math.cos(yaw), sn = Math.sin(yaw), cr = Math.cos(roll), sr = Math.sin(roll);
  const corners: Array<[number, number]> = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
  for (const [u, v] of corners) {
    const lx0 = u * w, ly0 = v * h;
    const lx = lx0 * cr - ly0 * sr, ly = lx0 * sr + ly0 * cr;
    pos.push(cx + lx * cs, cy + ly, cz - lx * sn);
    uv.push(u0 + (u + 0.5) * uw, (7 - row + v + 0.5) / 8);
    col.push(c.r, c.g, c.b); grp.push(0);
  }
  idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  return base;
}

function build(owner: number): Built {
  let b = built.get(owner);
  if (b) return b;
  const B = new Builder(), L = new Builder();
  // group 8: plaza
  B.grp = 8; L.grp = 8;
  B.add(G.cyl(1, 6), PLAZA.x, 0.012, PLAZA.z, 0x2a2e48, {sx: 0.4, sy: 0.024, sz: 0.4, ao: [1, 1]});
  for (const [r, c] of [[0.34, owner], [0.25, 0x31e8ff], [0.16, 0xff3aa8]] as const) L.add(G.torus(0.035), PLAZA.x, 0.03, PLAZA.z, c, {sx: r, sy: r, sz: 0.35, rx: Math.PI / 2, ao: [1, 1]});
  L.cyl(PLAZA.x, 0.024, PLAZA.z, 0.05, 0.02, 0xfff0c8, 1, 10);
  B.cyl(PLAZA.x, 0.024, PLAZA.z, 0.03, 0.12, 0x9aa4c0, 0.4, 8);
  // low shops along the front
  [[-0.32, 0.6], [-0.1, 0.62], [0.14, 0.62], [0.36, 0.58]].forEach(([x, z], i) => {
    B.box(x - 0.08, 0.024, z - 0.05, 0.16, 0.09 + (i % 2) * 0.03, 0.1, 0x4a5070);
    L.box(x - 0.07, 0.055, z + 0.052, 0.14, 0.03, 0.006, NEON[(i + 2) % NEON.length]);
  });
  // towers: groups 0..7
  TOWERS.forEach((t, i) => {
    B.grp = L.grp = i;
    B.box(t.x - t.w / 2, 0, t.z - t.d / 2, t.w, t.h, t.d, t.tint, {win: 3.2, ao: [0.6, 1.1]});
    B.box(t.x - t.w * 0.35, t.h, t.z - t.d * 0.35, t.w * 0.7, 0.07, t.d * 0.7, 0x3a4058, {win: 3.2});
    B.box(t.x - t.w / 2 - 0.006, t.h - 0.01, t.z - t.d / 2 - 0.006, t.w + 0.012, 0.012, t.d + 0.012, 0x2a2e40);
    if (t.spire) { B.cyl(t.x, t.h + 0.07, t.z, 0.008, t.spire, 0xb8c0d8, 0.4, 6); }
    // glowing edge strips and the crown
    const c = NEON[i % NEON.length];
    for (const [sx, sz] of [[-1, 1], [1, 1]]) L.box(t.x + sx * (t.w / 2) - 0.005, 0.04, t.z + sz * (t.d / 2) - 0.005, 0.01, t.h - 0.06, 0.01, i % 3 === 0 ? owner : c, {ao: [1, 1]});
    L.box(t.x - t.w / 2 - 0.007, t.h - 0.006, t.z - t.d / 2 - 0.007, t.w + 0.014, 0.008, t.d + 0.014, i % 3 === 0 ? owner : c, {ao: [1, 1]});
    if (t.spire) L.add(G.sph(), t.x, t.h + 0.07 + t.spire, t.z, owner, {sx: 0.014, sy: 0.014, sz: 0.014, ao: [1, 1]});
  });
  // sky-bridges (join the group of the later tower)
  const bridge = (a: number, bI: number, y: number) => {
    const ta = TOWERS[a], tb = TOWERS[bI];
    B.grp = L.grp = Math.max(a, bI);
    B.tube(ta.x, y, ta.z, tb.x, y, tb.z, 0.026, 0x8aa0c8, 8, [0.8, 1]);
    L.tube(ta.x, y + 0.012, ta.z + 0.01, tb.x, y + 0.012, tb.z + 0.01, 0.007, 0x31e8ff, 6, [1, 1]);
  };
  bridge(0, 1, 0.62); bridge(1, 2, 0.5); bridge(2, 3, 0.4); bridge(0, 4, 0.34); bridge(7, 3, 0.3);
  // sign quads: 8 horizontal neon strips on the towers' front faces (grp = tower index), 4 holo panels (grp 8..11)
  const pos: number[] = [], uv: number[] = [], col: number[] = [], grp: number[] = [], idx: number[] = [];
  const mark = (from: number, g: number) => { for (let i = from; i < grp.length; i++) grp[i] = g; };
  TOWERS.forEach((t, i) => {
    const from = grp.length;
    quad(pos, uv, col, grp, idx, t.x, t.h * (0.5 + 0.12 * hash(i, 1)), t.z + t.d / 2 + 0.006, t.w * 0.92, t.w * 0.92 / 4, 0, 0, i % 4, NEON[i % NEON.length], i % 2 ? 0.5 : 0, 0.5);
    mark(from, i);
  });
  HOLOS.forEach((h, i) => {
    const from = grp.length;
    quad(pos, uv, col, grp, idx, h.x, h.y, h.z, h.w, h.h, h.yaw, 0, 4 + i, h.col, 0, 0.25);
    mark(from, 8 + i);
  });
  const signs = new THREE.BufferGeometry();
  signs.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); signs.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  signs.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); signs.setAttribute('aGrp', new THREE.Float32BufferAttribute(grp, 1));
  signs.setIndex(idx);
  // drone
  const D = new Builder();
  D.box(-0.018, 0.0, -0.018, 0.036, 0.012, 0.036, 0x30343e);
  for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { D.bar(0, 0.006, 0, dx * 0.03, 0.01, dz * 0.03, 0.005, 0x20232a); D.cyl(dx * 0.03, 0.01, dz * 0.03, 0.014, 0.004, 0xa8b0c0, 1, 8); }
  D.box(-0.01, -0.01, -0.01, 0.02, 0.01, 0.02, 0x20232a);
  const body = B.build(), lit = L.build(), drone = D.build();
  b = {body, lit, signs, drone, tris: triCount(body) + triCount(lit) + idx.length / 3 + triCount(drone) * N_DRONE};
  built.set(owner, b);
  return b;
}

// ---- component ------------------------------------------------------------------------------------------------
const dummy = new THREE.Object3D();
const GL = {drone: 0, spire: 12, col: 16, halo: 24, holo: 32, owner: 36, spark: 38, n: 48};
const DR = Array.from({length: N_DRONE}, (_, k) => ({cx: (hash(k, 1) - 0.5) * 0.8, cz: -0.1 + (hash(k, 2) - 0.5) * 0.7, ra: 0.18 + hash(k, 3) * 0.25, sp: (0.25 + hash(k, 4) * 0.35) * (k % 2 ? 1 : -1), y: 0.55 + hash(k, 5) * 0.55, ph: hash(k, 6) * 6.28}));

export default function CommercialDistrict(p: ModelProps) {
  const owner = p.color && PLAYER_HEX[p.color] ? parseInt(PLAYER_HEX[p.color].slice(1), 16) : 0xffc86a;
  const mirror = useMemo(() => (seeded(p.id)() < 0.5 ? -1 : 1), [p.id]);
  const geo = useMemo(() => build(owner), [owner]);
  const tx = useMemo(() => textures(), []);
  const bodyM = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({vertexColors: true, map: tx.facade, emissiveMap: tx.emissive, emissive: 0xffffff, emissiveIntensity: 0.1, roughness: 0.35, metalness: 0.5});
    return riseMaterial(m, 'com-body');
  }, [tx]);
  const rise = bodyM.rise;
  const litM = useMemo(() => riseMaterial(new THREE.MeshBasicMaterial({vertexColors: true}), 'com-lit', undefined, rise), [rise]);
  const sign = useMemo(() => {
    const mat = new THREE.MeshBasicMaterial({map: tx.atlas, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide});
    const on = new Float32Array(12);
    mat.onBeforeCompile = (s) => {
      s.uniforms.uOn = {value: on}; s.uniforms.uTime = timeU;
      s.vertexShader = 'attribute float aGrp;\nuniform float uTime;\nvarying float vGrp;\n' + s.vertexShader.replace('#include <begin_vertex>',
        'vec3 transformed = vec3(position);\nvGrp = aGrp;\ntransformed.y += step(7.5, aGrp) * 0.014 * sin(uTime * 1.3 + aGrp * 2.0);');
      s.fragmentShader = 'uniform float uOn[12];\nuniform float uTime;\nvarying float vGrp;\n' + s.fragmentShader.replace('#include <map_fragment>',
        `#include <map_fragment>
        float holo = step(7.5, vGrp);
        float on = uOn[int(vGrp + 0.5)];
        float sh = mix(0.9 + 0.1 * sin(uTime * 23.0 + vGrp * 5.0), 0.72 + 0.28 * sin(vMapUv.y * 900.0 - uTime * 6.0 + vGrp), holo);
        diffuseColor.rgb *= on * sh * (1.0 + holo * 0.5);
        diffuseColor.a *= on;`);
    };
    mat.customProgramCacheKey = () => 'com-sign';
    return {mat, on};
  }, [tx]);
  const droneMat = useMemo(() => new THREE.MeshStandardMaterial({vertexColors: true, roughness: 0.5, metalness: 0.5}), []);
  const glow = useMemo(() => makeGlow(GL.n), []);
  const drones = useRef<THREE.InstancedMesh>(null);
  const {camera} = useThree();
  useEffect(() => () => { bodyM.mat.dispose(); litM.mat.dispose(); sign.mat.dispose(); droneMat.dispose(); glow.points.geometry.dispose(); }, [bodyM, litM, sign, droneMat, glow]);

  useFrame((state) => {
    const t = world.t, night = p.night, a = world.reduced ? 99 : p.age();
    timeU.value = t;
    setGlowScale(state.size.height * state.gl.getPixelRatio(), (camera as THREE.PerspectiveCamera).fov ?? 40);
    rise[8] = easeOutBack(ramp(a, 0, 0.5));
    for (let i = 0; i < 8; i++) rise[i] = easeOutCubic(ramp(a, 0.2 + i * 0.12, 0.8));
    bodyM.mat.emissiveIntensity = 0.08 + 0.75 * night;
    const gl = glow, on = sign.on;
    // neon signs flicker on one by one
    for (let i = 0; i < 12; i++) {
      const t0 = 1.3 + i * 0.1, f = a - t0;
      let v: number;
      if (f < 0) v = 0; else if (f < 0.45) v = Math.sin(f * 90) + Math.sin(f * 53 + i) > -0.2 ? 1 : 0.1; else v = 1;
      on[i] = v * (0.65 + 0.35 * night);
      if (!world.reduced && v === 1 && hash(Math.floor(t * 6) + i * 7, 19) > 0.985) on[i] *= 0.3;
    }
    // halos behind the signs
    for (let i = 0; i < 8; i++) {
      const tw = TOWERS[i], k = GL.halo + i, o = k * 3;
      gl.pos[o] = tw.x; gl.pos[o + 1] = tw.h * (0.5 + 0.12 * hash(i, 1)); gl.pos[o + 2] = tw.z + tw.d / 2 + 0.03;
      setCol(gl.col, k, NEON[i % NEON.length]); gl.kind[k] = 1; gl.size[k] = 0.22; gl.alpha[k] = on[i] * (0.18 + 0.4 * night) * (rise[i] > 0.99 ? 1 : 0);
    }
    for (let i = 0; i < 4; i++) {
      const h = HOLOS[i], k = GL.holo + i, o = k * 3;
      gl.pos[o] = h.x; gl.pos[o + 1] = h.y + 0.014 * Math.sin(t * 1.3 + (8 + i) * 2); gl.pos[o + 2] = h.z - 0.02;
      setCol(gl.col, k, h.col); gl.kind[k] = 1; gl.size[k] = 0.42; gl.alpha[k] = on[8 + i] * (0.12 + 0.35 * night);
    }
    // spire beacons (blinking red) and plaza light column
    for (let i = 0; i < 2; i++) {
      const tw = TOWERS[i === 0 ? 0 : 2], k = GL.spire + i, o = k * 3, r = rise[i === 0 ? 0 : 2];
      gl.pos[o] = tw.x; gl.pos[o + 1] = (tw.h + 0.07 + (tw.spire ?? 0)) * r; gl.pos[o + 2] = tw.z;
      setCol(gl.col, k, owner); gl.kind[k] = 1; gl.size[k] = 0.2; gl.alpha[k] = (0.5 + 0.5 * night) * (0.5 + 0.5 * Math.max(0, Math.sin(t * 2.6 + i * 1.7))) * clamp01(r * 1.5);
    }
    for (let i = 0; i < 8; i++) {
      const k = GL.col + i, o = k * 3, u = ((t * 0.35 + i / 8) % 1);
      gl.pos[o] = PLAZA.x; gl.pos[o + 1] = 0.05 + u * 0.7; gl.pos[o + 2] = PLAZA.z;
      setCol(gl.col, k, i % 2 ? 0x31e8ff : owner); gl.kind[k] = 1; gl.size[k] = 0.16 + 0.1 * (1 - u); gl.alpha[k] = (0.18 + 0.4 * night) * (1 - u) * clamp01(rise[8] * (world.reduced ? 0.6 : 1));
    }
    gl.pos[GL.owner * 3] = PLAZA.x; gl.pos[GL.owner * 3 + 1] = 0.06; gl.pos[GL.owner * 3 + 2] = PLAZA.z;
    setCol(gl.col, GL.owner, owner); gl.kind[GL.owner] = 1; gl.size[GL.owner] = 0.9; gl.alpha[GL.owner] = (0.15 + 0.4 * night) * clamp01(rise[8]);
    gl.pos[(GL.owner + 1) * 3] = PLAZA.x; gl.pos[(GL.owner + 1) * 3 + 1] = 0.05; gl.pos[(GL.owner + 1) * 3 + 2] = PLAZA.z;
    setCol(gl.col, GL.owner + 1, 0x31e8ff); gl.kind[GL.owner + 1] = 1; gl.size[GL.owner + 1] = 0.55; gl.alpha[GL.owner + 1] = (0.1 + 0.3 * night) * clamp01(rise[8]);
    // sparkles across the glass
    for (let i = 0; i < 10; i++) {
      const k = GL.spark + i, o = k * 3, tw = TOWERS[i % 5];
      const ph = (t * 0.7 + hash(i, 61) * 5) % 4, tws = Math.pow(Math.max(0, Math.sin(ph * 1.57)), 20);
      gl.pos[o] = tw.x + (hash(i, 62) - 0.5) * tw.w; gl.pos[o + 1] = tw.h * (0.3 + 0.65 * hash(i, 63)) * rise[i % 5]; gl.pos[o + 2] = tw.z + tw.d / 2 + 0.01;
      setCol(gl.col, k, 0xdff4ff); gl.kind[k] = 2; gl.size[k] = 0.1 * (0.3 + tws); gl.alpha[k] = tws * (0.35 + 0.35 * night) * clamp01(rise[i % 5] * 1.2) * (world.reduced ? 0.6 : 1);
    }
    // drones
    const dm = drones.current, live = easeOutBack(ramp(a, 1.7, 0.6));
    for (let k = 0; k < N_DRONE; k++) {
      const d = DR[k], ang = world.reduced ? d.ph : t * d.sp + d.ph;
      const x = d.cx + Math.cos(ang) * d.ra, z = d.cz + Math.sin(ang) * d.ra * 0.8, y = (d.y + 0.03 * (world.reduced ? 0 : Math.sin(t * 1.7 + k))) * live;
      dummy.position.set(x, y, z);
      dummy.rotation.set(Math.cos(ang) * 0.12, -ang, -Math.sin(ang) * 0.12);
      dummy.scale.setScalar(Math.max(live, 0.001));
      dummy.updateMatrix(); dm?.setMatrixAt(k, dummy.matrix);
      for (let s = 0; s < 2; s++) {
        const i = GL.drone + k * 2 + s, o = i * 3;
        gl.pos[o] = x + (s ? 0.025 : -0.025); gl.pos[o + 1] = y + 0.012; gl.pos[o + 2] = z + 0.02;
        const blink = s ? Math.max(0, Math.sin(t * 4.5 + k * 2) * 3) : (Math.sin(t * 2.2 + k) > 0.6 ? 1 : 0.15);
        setCol(gl.col, i, s ? 0xff3030 : 0x50ff90); gl.kind[i] = 1; gl.size[i] = 0.07; gl.alpha[i] = clamp01(blink) * live * (0.5 + 0.5 * night) * 1.2;
      }
    }
    if (dm) dm.instanceMatrix.needsUpdate = true;
    gl.dirty();
  });

  return (
    <group position={[0, p.top, 0]} scale={[p.radius * mirror, p.radius, p.radius]}>
      <mesh geometry={geo.body} material={bodyM.mat} />
      <mesh geometry={geo.lit} material={litM.mat} />
      <mesh geometry={geo.signs} material={sign.mat} renderOrder={5} />
      <instancedMesh ref={drones} args={[geo.drone, droneMat, N_DRONE]} frustumCulled={false} />
      <primitive object={glow.points} />
    </group>
  );
}
