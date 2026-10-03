// Detailed Industrial Center: a dense heavy-industry complex. Three tall stacks with striped shafts, platforms and glowing
// rims under layered smoke, a sawtooth smelter hall with glowing furnace doors, two blast furnaces feeding molten runners
// to a casting bed where a gantry-mounted ladle pours into ingot moulds, a cooling tower with steam, a pipe rack, tanks,
// a spherical tank, a rail spur where a switcher shuffles three cars, a container gantry crane, lit control rooms, sparks.
// Build-in: the yard sets, the stacks extend one after another and ignite, the hall and furnaces rise, the cranes arrive.
// detail='lite' keeps the same layout in <= 6 draw calls.
import {useFrame, useThree} from '@react-three/fiber';
import {useEffect, useMemo, useRef} from 'react';
import * as THREE from 'three';
import {PLAYER_HEX} from '../../../../../../shared/game';
import {seeded, world} from '../../tiles3d';
import type {ModelMeta, ModelProps} from '../contract';
import {clamp01, easeOutBack, easeOutCubic, hash, lampPatch, makeGlow, ramp, riseMaterial, setCol, setGlowScale, smooth, timeU} from '../MineKit';
import {mineTextures} from './MineGround';
import {BED, BF, COOL, CRANE, CTRL, FANS, HALL, LADLE_RAIL, LAMPS, RAIL_Z, SL, STACKS, buildIndustrial, type IndGeo} from './IndustrialParts';
import {industrialTextures, moltenMaterial} from './IndustrialTex';

export const meta: ModelMeta = {set: 'detailed', name: 'Industrial Center', tileTypes: [6], kind: 'special', buildSeconds: 3.4};

const built = new Map<string, IndGeo>();
function build(owner: number, full: boolean) {
  const key = `${owner}|${full}`;
  let b = built.get(key);
  if (!b) {
    b = buildIndustrial(owner, full); built.set(key, b);
    const tc = (g: THREE.BufferGeometry) => Math.round((g.index ? g.index.count : g.attributes.position?.count ?? 0) / 3);
    const w = globalThis as unknown as {__detailedStats?: Record<string, unknown>};
    w.__detailedStats = {...(w.__detailedStats ?? {}), [`ind-${full ? 'full' : 'lite'}`]: {body: tc(b.body), halls: tc(b.halls), lit: tc(b.lit), molten: tc(b.molten), train: tc(b.train), portal: tc(b.portal)}};
  }
  return b;
}

const WIND = [0.2, 0.06];
const GLN = {smoke: 54, top: 3, ownerRing: 3, ignite: 18, door: 3, pool: 8, spark: 40, steam: 14, lamp: 7, flare: 2, ladle: 3, stream: 4, loco: 4, craneLight: 2, ctrl: 2, redTop: 3, owner: 3, tsmoke: 4};
const GL: Record<string, number> = {}; let acc = 0;
for (const k of Object.keys(GLN) as Array<keyof typeof GLN>) { GL[k] = acc; acc += GLN[k]; }
const GL_N = acc;
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
function setMix(arr: Float32Array, i: number, a: number, b: number, t: number, k: number) {
  const ar = ((a >> 16) & 255) / 255, ag = ((a >> 8) & 255) / 255, ab = (a & 255) / 255, br = ((b >> 16) & 255) / 255, bg = ((b >> 8) & 255) / 255, bb = (b & 255) / 255;
  arr[i * 3] = mix(ar, br, t) * k; arr[i * 3 + 1] = mix(ag, bg, t) * k; arr[i * 3 + 2] = mix(ab, bb, t) * k;
}
const gp = (gl: ReturnType<typeof makeGlow>, i: number, x: number, y: number, z: number, hex: number, size: number, alpha: number, kind: number, k = 1) => {
  const o = i * 3; gl.pos[o] = x; gl.pos[o + 1] = y; gl.pos[o + 2] = z; setCol(gl.col, i, hex, k); gl.size[i] = size; gl.alpha[i] = alpha; gl.kind[i] = kind;
};
/** a 0..1 position in a keyframed cycle: holds and smooth moves between [start, end, from, to] */
const SEGS: number[][] = [[0, 1.5, 0, 0], [1.5, 3.5, 0, 1], [3.5, 7.5, 1, 2], [7.5, 9.5, 2, 3], [9.5, 11, 3, 3], [11, 13, 3, 2], [13, 17, 2, 1], [17, 19, 1, 0], [19, 20, 0, 0]];
// crane keyframes: [trolley z, container origin y]
const CZ = [0.66, 0.66, 0.5, 0.5], CY = [SL + 0.102, SL + 0.2, SL + 0.2, SL + 0.032];
function craneAt(c: number, out: number[]) {
  // 0 rest at stack, 1 lifted at stack, 2 lifted at the pad, 3 down at the pad
  let a = 0, b = 0, f = 0;
  for (const s of SEGS) if (c >= s[0] && c < s[1]) { a = s[2]; b = s[3]; f = smooth(0, 1, (c - s[0]) / (s[1] - s[0])); break; }
  const pa = [0, 0, 0, 0, 0], pb = [0, 0, 0, 0, 0]; void pa; void pb;
  // positions: z follows the lifted states, y follows each state
  const zA = a === 0 || a === 1 ? CZ[0] : CZ[2], zB = b === 0 || b === 1 ? CZ[0] : CZ[2];
  out[0] = zA + (zB - zA) * f; out[1] = CY[a] + (CY[b] - CY[a]) * f;
}
const cr = [0, 0];
let cableG: THREE.BufferGeometry | null = null;
const getCable = () => cableG ?? (cableG = new THREE.BoxGeometry(0.004, 1, 0.004).translate(0, -0.5, 0));
let streamG: THREE.BufferGeometry | null = null;
const getStream = () => streamG ?? (streamG = new THREE.BoxGeometry(0.014, 1, 0.014).translate(0, -0.5, 0));

export default function IndustrialCenter(p: ModelProps) {
  const full = p.detail !== 'lite';
  const owner = p.color && PLAYER_HEX[p.color] ? parseInt(PLAYER_HEX[p.color].slice(1), 16) : 0xffc86a;
  const mirror = useMemo(() => (seeded(p.id)() < 0.5 ? -1 : 1), [p.id]);
  const geo = useMemo(() => build(owner, full), [owner, full]);
  const lampP = useMemo(() => {
    const l = lampPatch(12);
    const d = (i: number) => HALL.x0 + 0.1 + i * 0.2;
    l.lamps.set([d(0), 0.08, HALL.z1 + 0.1, 0.45, d(1), 0.08, HALL.z1 + 0.1, 0.45, d(2), 0.08, HALL.z1 + 0.1, 0.45, BF[0].x, 0.1, BF[0].z + 0.15, 0.4, BF[1].x, 0.1, BF[1].z + 0.15, 0.4,
      -0.43, 0.06, BED.z, 0.4, CTRL.x, 0.15, CTRL.z + 0.1, 0.4, 0.0, 0.08, 0.5, 0.55, 0.45, 0.1, 0.1, 0.5, STACKS[0].x, 0.55, STACKS[0].z + 0.08, 0.5, STACKS[1].x, 0.45, STACKS[1].z + 0.08, 0.45, STACKS[2].x, 0.4, STACKS[2].z + 0.08, 0.4]);
    return l;
  }, []);
  const T = useMemo(() => ({...industrialTextures(), mine: mineTextures()}), []);
  const bodyM = useMemo(() => riseMaterial(new THREE.MeshStandardMaterial({vertexColors: true, map: T.grunge, color: new THREE.Color(1.8, 1.8, 1.8), roughness: 0.78, metalness: 0.05}), 'ind-d-body', lampP.extra), [lampP, T]);
  const rise = bodyM.rise;
  const hallM = useMemo(() => riseMaterial(new THREE.MeshStandardMaterial({vertexColors: true, map: T.facade, color: new THREE.Color(1.3, 1.3, 1.3), emissiveMap: T.emissive, emissive: 0xffffff, emissiveIntensity: 0.05, roughness: 0.7, metalness: 0.1}), 'ind-d-halls', undefined, rise), [T, rise]);
  const litM = useMemo(() => riseMaterial(new THREE.MeshBasicMaterial({vertexColors: true}), 'ind-d-lit', undefined, rise), [rise]);
  const molten = useMemo(() => moltenMaterial([0.18, 0, 0]), []);
  const stream = useMemo(() => moltenMaterial([0, 1.6, 0]), []);
  const mover = useMemo(() => new THREE.MeshStandardMaterial({vertexColors: true, color: new THREE.Color(1.6, 1.6, 1.6), roughness: 0.6, metalness: 0.08, emissive: 0x3a2a18}), []);
  const cableM = useMemo(() => new THREE.MeshBasicMaterial({color: 0x15171a}), []);
  const glow = useMemo(() => makeGlow(GL_N), []);
  const {camera} = useThree();
  const portalRef = useRef<THREE.Group>(null), ladleRef = useRef<THREE.Group>(null), streamRef = useRef<THREE.Mesh>(null), trolleyRef = useRef<THREE.Group>(null), cableRef = useRef<THREE.Mesh>(null), contRef = useRef<THREE.Mesh>(null);
  const trainRef = useRef<THREE.Mesh>(null), fans = useRef<THREE.InstancedMesh>(null), moltenRef = useRef<THREE.Mesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useEffect(() => () => { bodyM.mat.dispose(); hallM.mat.dispose(); litM.mat.dispose(); molten.mat.dispose(); stream.mat.dispose(); mover.dispose(); cableM.dispose(); glow.points.geometry.dispose(); }, [bodyM, hallM, litM, molten, stream, mover, cableM, glow]);

  useFrame((state) => {
    const t = world.t, night = p.night, a = world.reduced ? 99 : p.age();
    timeU.value = t;
    setGlowScale(state.size.height * state.gl.getPixelRatio(), (camera as THREE.PerspectiveCamera).fov ?? 40);
    rise[0] = easeOutCubic(ramp(a, 0, 0.6));
    rise[4] = easeOutBack(ramp(a, 0.35, 0.9));
    rise[5] = easeOutBack(ramp(a, 0.8, 0.9));
    rise[6] = easeOutBack(ramp(a, 1.3, 0.9));
    lampP.uLit.value = night * 0.75 * (0.4 + 0.6 * ramp(a, 1.8, 0.8));
    hallM.mat.emissiveIntensity = (0.04 + 0.95 * night) * clamp01(rise[4]);
    litM.mat.color.setScalar(0.5 + 0.5 * night);
    mover.emissiveIntensity = night * 0.7;
    molten.uNight.value = night; stream.uNight.value = night;
    const gl = glow;
    for (let i = 0; i < GL_N; i++) gl.alpha[i] = 0;
    const flick = 0.85 + 0.15 * Math.sin(t * 9.3) * Math.sin(t * 4.1 + 1);
    const nSm = full ? 18 : 11, szk = full ? 1 : 1.3;
    for (let s = 0; s < 3; s++) {
      const st = STACKS[s], t0 = 0.2 + s * 0.35, len = 0.9;
      const r = world.reduced ? 1 : easeOutCubic(ramp(a, t0, len));
      rise[1 + s] = r;
      const ign = a - (t0 + len), lit = world.reduced ? 1 : smooth(0, 0.5, ign);
      const topY = SL + st.h * Math.max(r, 0.001);
      for (let k = 0; k < nSm; k++) {
        const i = GL.smoke + s * 18 + k, life = (t * 0.15 + k / nSm + hash(s, 3)) % 1;
        const rd = hash(k + s * 20, 5), sw = Math.sin(t * 0.7 + k * 1.9 + s * 3) * 0.04 * life;
        // three layers: hot orange core, sooty middle, pale steam above
        gp(gl, i, st.x + WIND[0] * life * (1 + rd * 0.5) + sw, topY + 0.03 + life * 0.8, st.z + WIND[1] * life + hash(k + s, 6) * 0.03, 0xffa24a, (0.07 + life * 0.3) * szk, 0.55 * Math.sin(Math.PI * Math.pow(life, 0.7)) * lit * (world.reduced ? 0.6 : 1) * (0.7 + 0.3 * rd), 0);
        setMix(gl.col, i, 0xffa24a, s === 1 ? (night > 0.5 ? 0x3a3840 : 0x6a655f) : (night > 0.5 ? 0x4a4850 : 0xb4aea6), smooth(0, 0.22 + 0.4 * night, life) * (1 - 0.15 * night), 1 + 0.5 * night * (1 - life));
      }
      gp(gl, GL.top + s, st.x, topY + 0.03, st.z, 0xff8a2a, 0.3 * (0.9 + 0.1 * flick), (0.35 + 0.5 * night) * lit * flick, 1);
      gp(gl, GL.ownerRing + s, st.x, SL + st.h * 0.74 * r, st.z + st.r0 * 0.9, owner, 0.2, (0.3 + 0.5 * night) * clamp01(r * 2), 1);
      gp(gl, GL.redTop + s, st.x, topY + 0.085, st.z, 0xff3030, 0.1, (Math.sin(t * 2.4 + s * 2) > 0.3 ? 0.9 : 0.12) * clamp01(r * 2), 1);
      if (full) for (let k = 0; k < 6; k++) {
        const u = clamp01(ign / 0.8), ang = (k / 6) * 6.283 + s, rad = u * 0.22;
        gp(gl, GL.ignite + s * 6 + k, st.x + Math.cos(ang) * rad, topY + 0.04 + u * 0.18, st.z + Math.sin(ang) * rad, 0xffb060, 0.12 + u * 0.16, ign > 0 && ign < 0.8 ? 0.8 * (1 - u) : 0, 1);
      }
    }
    // furnace-door glow, pools of warm light, blast-furnace flares
    for (let i = 0; i < 3; i++) {
      const x = HALL.x0 + 0.1 + i * 0.2;
      gp(gl, GL.door + i, x, (SL + 0.05) * rise[4], HALL.z1 + 0.04, 0xff7a1a, 0.4, (0.4 + 0.5 * night) * flick * clamp01(rise[4] * 1.2), 1);
      gp(gl, GL.pool + i, x, SL + 0.012, HALL.z1 + 0.14, 0xff9a50, 0.8, 0.2 * (0.15 + 0.85 * night) * flick * clamp01(rise[4]), 1, 0.9);
    }
    gp(gl, GL.pool + 3, -0.43, SL + 0.03, BED.z, 0xff8a30, 0.8, 0.28 * (0.2 + 0.8 * night) * flick * clamp01(rise[6]), 1);
    gp(gl, GL.pool + 4, BF[0].x, SL + 0.02, BF[0].z + 0.15, 0xff9a50, 0.6, 0.2 * (0.15 + 0.85 * night) * flick * clamp01(rise[4]), 1);
    gp(gl, GL.pool + 5, BF[1].x, SL + 0.02, BF[1].z + 0.15, 0xff9a50, 0.6, 0.2 * (0.15 + 0.85 * night) * flick * clamp01(rise[4]), 1);
    for (let k = 0; k < 2; k++) gp(gl, GL.flare + k, BF[k].x, (SL + BF[k].h + 0.1) * rise[4], BF[k].z, 0xff8a2a, 0.3, (0.3 + 0.55 * night) * flick * clamp01(rise[4] * 1.2), 1);
    // owner glows on the hall edge and the cooling tower's rim
    gp(gl, GL.owner, HALL.x0 + 0.16, (SL + HALL.h - 0.006) * rise[4], HALL.z1 + 0.02, owner, 0.22, (0.35 + 0.55 * night) * (0.75 + 0.25 * Math.sin(t * 2.4)) * clamp01(rise[4]), 1);
    gp(gl, GL.owner + 1, HALL.x1 - 0.16, (SL + HALL.h - 0.006) * rise[4], HALL.z1 + 0.02, owner, 0.22, (0.35 + 0.55 * night) * (0.75 + 0.25 * Math.sin(t * 2.4 + 2)) * clamp01(rise[4]), 1);
    gp(gl, GL.owner + 2, COOL.x, (SL + COOL.h) * rise[5], COOL.z + 0.1, owner, 0.28, (0.3 + 0.5 * night) * clamp01(rise[5]), 1);
    for (let i = 0; i < 7; i++) gp(gl, GL.lamp + i, LAMPS[i][0], (SL + 0.19) * rise[0], LAMPS[i][1] + 0.01, 0xffe2a0, 0.1, (0.15 + 0.85 * night) * rise[0], 1);
    gp(gl, GL.ctrl, CTRL.x, (SL + 0.16) * rise[4], CTRL.z + 0.07, 0xbfe4ff, 0.26, 0.4 * night * clamp01(rise[4]), 1);
    gp(gl, GL.ctrl + 1, -0.47, (SL + 0.04) * rise[4], 0.58, 0xffd27a, 0.2, 0.3 * night * clamp01(rise[4]), 1);
    // cooling tower steam
    for (let k = 0; k < (full ? 14 : 6); k++) {
      const life = (t * 0.1 + k / (full ? 14 : 6) + hash(k, 8)) % 1;
      gp(gl, GL.steam + k, COOL.x + WIND[0] * life * 0.8 + Math.sin(k * 2 + t * 0.4) * 0.03, (SL + COOL.h + 0.02 + life * 0.5) * rise[5], COOL.z + WIND[1] * life, night > 0.5 ? 0x7a8090 : 0xe4e6ea, 0.1 + life * 0.2, 0.22 * Math.sin(Math.PI * life) * clamp01(rise[5]) * (world.reduced ? 0.6 : 1), 0, 1.0);
    }
    // sparks from the furnace doors, the tap holes and the pour
    const nSp = full ? 40 : 8;
    for (let k = 0; k < nSp; k++) {
      const src = k % 4, per = 2.4 + hash(k, 41) * 3, ph = (t + hash(k, 42) * per) % per, life = ph / 0.9;
      const x0 = src === 0 ? HALL.x0 + 0.1 : src === 1 ? HALL.x0 + 0.3 : src === 2 ? BF[1].x + 0.1 : HALL.x0 + 0.5, z0 = src === 2 ? BF[1].z + 0.12 : HALL.z1 + 0.04;
      const vx = (hash(k, 43) - 0.5) * 0.3, vy = 0.2 + hash(k, 44) * 0.3, vz = 0.06 + hash(k, 45) * 0.2;
      gp(gl, GL.spark + k, x0 + vx * ph, SL + 0.06 + vy * ph - 0.5 * 0.9 * ph * ph, z0 + vz * ph, 0xffc070, 0.05, world.reduced || life >= 1 ? 0 : (1 - life) * clamp01(rise[4]), 2);
    }
    // ladle portal, pour, container crane, train, fans
    const live = clamp01(rise[6]);
    const lc = world.reduced ? 5.2 : t % 16;
    // ladle cycle (16 s): come in, tilt, pour along the moulds, level, go back
    const x0 = BED.x0 + 0.06, x1 = BED.x1 - 0.05;
    let px: number, tilt: number;
    if (lc < 3) { px = mix(x1, x0, smooth(0, 1, lc / 3)); tilt = 0; }
    else if (lc < 4) { px = x0; tilt = smooth(0, 1, lc - 3) * 0.95; }
    else if (lc < 11) { px = mix(x0, x1, (lc - 4) / 7); tilt = 0.95; }
    else if (lc < 12) { px = x1; tilt = 0.95 * (1 - smooth(0, 1, lc - 11)); }
    else { px = x1; tilt = 0; }
    const pouring = tilt > 0.9 ? 1 : 0;
    const pg = portalRef.current;
    if (pg) {
      pg.position.set(px, 0, BED.z); pg.scale.set(1, Math.max(live, 0.001), 1);
      if (ladleRef.current) { ladleRef.current.rotation.z = -tilt; ladleRef.current.position.set(0, SL + 0.19, 0); }
      const lipX = px + 0.048 * Math.cos(tilt), lipY = (SL + 0.19) * live - 0.048 * Math.sin(tilt) - 0.004;
      const sm = streamRef.current;
      if (sm) {
        sm.visible = pouring > 0 && live > 0.9;
        sm.position.set(lipX - px, lipY, 0); sm.scale.set(1, Math.max(0.001, lipY - (SL + 0.03)), 1);
      }
      if (pouring > 0 && live > 0.9) {
        gp(gl, GL.stream, lipX, SL + 0.04, BED.z, 0xffa040, 0.16, 0.6 * (0.7 + 0.3 * flick), 1);
        gp(gl, GL.stream + 1, lipX, (SL + 0.04 + lipY) / 2, BED.z, 0xff9a40, 0.1, 0.35, 1);
        gp(gl, GL.stream + 2, lipX, lipY, BED.z, 0xffc060, 0.12, 0.5, 1);
        if (full) for (let k = 0; k < 3; k++) { const ph = (t * 1.7 + k * 0.33) % 1; gp(gl, GL.stream + 3, lipX + (hash(k, 5) - 0.5) * 0.05 * ph, SL + 0.04 + ph * 0.07, BED.z + (hash(k, 6) - 0.5) * 0.04, 0xffd080, 0.04, 0.8 * (1 - ph), 2); }
      }
      gp(gl, GL.ladle, px, (SL + 0.14) * live, BED.z, 0xff9a30, 0.2, (0.25 + 0.45 * night) * live, 1);
    }
    // container crane (20 s)
    craneAt(world.reduced ? 3 : t % 20, cr);
    const tr = trolleyRef.current, cb = cableRef.current, ct = contRef.current;
    const beamY = (SL + CRANE.h - 0.012) * live;
    if (tr) tr.position.set(CRANE.x, beamY, cr[0]);
    if (ct) { ct.position.set(CRANE.x, cr[1] * live, cr[0]); }
    if (cb) { cb.position.set(CRANE.x, beamY, cr[0]); cb.scale.set(1, Math.max(0.001, beamY - (cr[1] * live + 0.016)), 1); }
    gp(gl, GL.craneLight, CRANE.x, (SL + CRANE.h + 0.012) * live, CRANE.z0 - 0.01, 0xff3030, 0.1, (Math.sin(t * 3) > 0 ? 0.9 : 0.15) * live, 1);
    gp(gl, GL.craneLight + 1, CRANE.x, beamY - 0.015, cr[0], 0xfff0c0, 0.12, (0.2 + 0.6 * night) * live, 1);
    // the train shuttles under the crane: 24 s cycle with dwell
    const trn = trainRef.current;
    if (trn) {
      const c = world.reduced ? 5 : t % 28;
      const xa = -0.15, xb = 0.18;
      let tx: number;
      if (c < 5) tx = xa; else if (c < 13) tx = mix(xa, xb, smooth(0, 1, (c - 5) / 8)); else if (c < 19) tx = xb; else if (c < 27) tx = mix(xb, xa, smooth(0, 1, (c - 19) / 8)); else tx = xa;
      trn.position.set(tx, (SL + 0.015) * live, RAIL_Z); trn.rotation.y = Math.PI / 2; trn.scale.set(1, Math.max(live, 0.001), 1);
      const hx = tx + 0.28;
      gp(gl, GL.loco, hx + 0.02, SL + 0.045, RAIL_Z, 0xfff3d0, 0.09, (0.3 + 0.7 * night) * live, 1);
      for (let b = 0; b < 3; b++) gp(gl, GL.loco + 1 + b, hx + 0.08 + b * 0.07, SL + 0.04, RAIL_Z, 0xfff0c0, 0.07 + b * 0.04, (0.05 + 0.25 * night) * live * (1 - b * 0.25), 1);
      if (full) for (let k = 0; k < 4; k++) { const life = (t * 0.4 + k / 4) % 1; gp(gl, GL.tsmoke + k, tx + 0.15 - 0.0 + life * 0.05, SL + 0.1 + life * 0.1, RAIL_Z - 0.0, 0x8a8480, 0.05 + life * 0.08, 0.3 * Math.sin(Math.PI * life) * live, 0, 0.8); }
    }
    const fm = fans.current;
    if (fm) {
      for (let k = 0; k < FANS.length; k++) {
        dummy.position.set(FANS[k][0], FANS[k][1] * Math.max(rise[4], 0.001) + (k === 3 ? 0 : 0), FANS[k][2]);
        dummy.rotation.set(0, world.reduced ? k : t * (4 + k) + k, 0); dummy.scale.setScalar(Math.max(rise[4], 0.001));
        dummy.updateMatrix(); fm.setMatrixAt(k, dummy.matrix);
      }
      fm.instanceMatrix.needsUpdate = true;
    }
    if (moltenRef.current) moltenRef.current.visible = rise[4] > 0.4;
    gl.dirty();
  });

  const cableGeo = getCable();
  return (
    <group position={[0, p.top, 0]} scale={[p.radius * mirror, p.radius, p.radius]}>
      <mesh geometry={geo.body} material={bodyM.mat} />
      {full && <mesh geometry={geo.halls} material={hallM.mat} />}
      <mesh geometry={geo.lit} material={litM.mat} />
      <mesh ref={trainRef} geometry={geo.train} material={mover} frustumCulled={false} />
      {full && (
        <>
          <mesh ref={moltenRef} geometry={geo.molten} material={molten.mat} />
          <group ref={portalRef}>
            <mesh geometry={geo.portal} material={mover} />
            <group ref={ladleRef}><mesh geometry={geo.ladle} material={mover} /></group>
            <mesh ref={streamRef} geometry={getStream()} material={stream.mat} frustumCulled={false} />
          </group>
          <group ref={trolleyRef}><mesh geometry={geo.trolley} material={mover} /></group>
          <mesh ref={cableRef} geometry={cableGeo} material={cableM} frustumCulled={false} />
          <mesh ref={contRef} geometry={geo.container} material={mover} frustumCulled={false} />
          <instancedMesh ref={fans} args={[geo.fan, mover, FANS.length]} frustumCulled={false} />
        </>
      )}
      <primitive object={glow.points} />
    </group>
  );
}

void LADLE_RAIL; void easeOutBack;
