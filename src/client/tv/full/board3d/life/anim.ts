// Poses for the miniature's rig: each pose writes target rotations, offsets and scales for the bones from a clock and
// a couple of scene parameters; the character eases toward the target, so changing pose never pops. Nothing here
// allocates: the arrays are made once per character. Angles in radians; the front is +z; negative x rotation swings an
// arm or leg forward and up, positive on the torso leans forward, positive on the head looks down.
import type {Character} from './rig';
import {B, BONES, NB, REST_LOCAL, TOOLS} from './rig';
import type {BoneName} from './rig';

export type PoseId =
  | 'idle' | 'walk' | 'run' | 'carry' | 'dig' | 'pump' | 'push' | 'wave' | 'sit' | 'nap' | 'surf' | 'fish' | 'mop' | 'flinch' | 'peek'
  | 'celebrate' | 'shades' | 'selfie' | 'throw' | 'catch' | 'plant' | 'flag' | 'lookup' | 'soaked' | 'roll' | 'tada' | 'startle' | 'eat' | 'point' | 'camwave' | 'slump';

const S = 7; // channels per bone: rx ry rz px py pz scale

export type PoseState = {
  pose: PoseId;
  /** seconds in this pose (cycles run from it) */
  t: number;
  /** walking phase, radians (advances with distance walked) */
  ph: number;
  /** scene parameters: a is usually a 0..1 progress, b a 0..1 intensity */
  a: number; b: number;
  /** how fast the bones ease toward the target, per second */
  rate: number;
  cur: Float32Array; tgt: Float32Array;
};

const DEF = (() => {
  const d = new Float32Array(NB * S);
  for (let i = 0; i < NB; i++) d[i * S + 6] = 1;
  for (const n of TOOLS) d[B[n] * S + 6] = 0;
  d[B.visor * S] = -1.38; // visor up
  return d;
})();

export function makePose(): PoseState {
  return {pose: 'idle', t: 0, ph: 0, a: 0, b: 0, rate: 12, cur: DEF.slice(), tgt: DEF.slice()};
}

const R = (T: Float32Array, b: BoneName, x: number, y = 0, z = 0) => { const i = B[b] * S; T[i] = x; T[i + 1] = y; T[i + 2] = z; };
const Rx = (T: Float32Array, b: BoneName, x: number) => { T[B[b] * S] = x; };
const Ry = (T: Float32Array, b: BoneName, y: number) => { T[B[b] * S + 1] = y; };
const Rz = (T: Float32Array, b: BoneName, z: number) => { T[B[b] * S + 2] = z; };
const P = (T: Float32Array, b: BoneName, x: number, y: number, z: number) => { const i = B[b] * S; T[i + 3] = x; T[i + 4] = y; T[i + 5] = z; };
const Py = (T: Float32Array, b: BoneName, y: number) => { T[B[b] * S + 4] = y; };
const show = (T: Float32Array, b: BoneName, s = 1) => { T[B[b] * S + 6] = s; };
const sm = (x: number) => { const c = Math.min(1, Math.max(0, x)); return c * c * (3 - 2 * c); };

/** Bend the knees by `ang` with the feet kept near the ground (the hips come down as the legs fold forward). */
function crouch(T: Float32Array, ang: number) {
  Rx(T, 'legL', -ang); Rx(T, 'legR', -ang);
  Py(T, 'hips', -0.26 * (1 - Math.cos(ang)) - 0.01);
}

/** Standing: a slow breath and a look around. */
function breathe(T: Float32Array, t: number) {
  Py(T, 'root', Math.sin(t * 2.1) * 0.004);
  Ry(T, 'head', Math.sin(t * 0.7) * 0.35);
  Rz(T, 'armL', 0.1 + Math.sin(t * 2.1) * 0.02); Rz(T, 'armR', -0.1 - Math.sin(t * 2.1) * 0.02);
}

type Fn = (T: Float32Array, t: number, ph: number, a: number, b: number) => void;
const POSES: Record<PoseId, Fn> = {
  idle: (T, t) => breathe(T, t),
  walk: (T, t, ph, a) => {
    const s = Math.sin(ph), amp = 0.55 + 0.25 * a;
    Rx(T, 'legL', s * amp); Rx(T, 'legR', -s * amp);
    Rx(T, 'armL', -s * amp * 0.85); Rx(T, 'armR', s * amp * 0.85);
    Rz(T, 'armL', 0.12); Rz(T, 'armR', -0.12);
    Py(T, 'root', Math.abs(Math.cos(ph)) * 0.02);
    Rx(T, 'torso', 0.08); Ry(T, 'torso', s * 0.12); Ry(T, 'head', -s * 0.1);
  },
  run: (T, t, ph) => {
    const s = Math.sin(ph);
    Rx(T, 'legL', s * 1.0); Rx(T, 'legR', -s * 1.0);
    Rx(T, 'armL', -s * 1.1 - 0.3); Rx(T, 'armR', s * 1.1 - 0.3);
    Rz(T, 'armL', 0.2); Rz(T, 'armR', -0.2);
    Py(T, 'root', Math.abs(Math.cos(ph)) * 0.05);
    Rx(T, 'torso', 0.3); Ry(T, 'torso', s * 0.2);
  },
  carry: (T, t, ph) => {
    const s = Math.sin(ph);
    Rx(T, 'legL', s * 0.5); Rx(T, 'legR', -s * 0.5);
    R(T, 'armL', -1.25, 0, 0.3); R(T, 'armR', -1.25, 0, -0.3);
    Py(T, 'root', Math.abs(Math.cos(ph)) * 0.015);
    Rx(T, 'torso', -0.1); Rx(T, 'head', 0.1); show(T, 'tBrick');
  },
  dig: (T, t) => {
    const s = Math.sin(t * 4.2), up = Math.max(0, s);
    crouch(T, 0.25); Rz(T, 'legL', 0.14); Rz(T, 'legR', -0.14);
    Rx(T, 'torso', 0.4 + 0.25 * s); Rx(T, 'armR', -1.0 - 0.5 * s); Rx(T, 'armL', -1.1 - 0.35 * s);
    Rz(T, 'armL', 0.2); Rz(T, 'armR', -0.15); Rx(T, 'head', 0.25); show(T, 'tShovel');
    Py(T, 'root', up * 0.01);
  },
  pump: (T, t) => {
    const s = Math.sin(t * 5);
    crouch(T, 0.2); Rx(T, 'torso', 0.3 + 0.2 * s);
    Rx(T, 'armL', -1.1 - 0.5 * s); Rx(T, 'armR', -1.1 + 0.5 * s); Rz(T, 'armL', 0.15); Rz(T, 'armR', -0.15); Rx(T, 'head', 0.1);
  },
  push: (T, t, ph, a) => {
    const s = Math.sin(ph);
    Rx(T, 'legL', -0.35 + s * 0.35 * a); Rx(T, 'legR', 0.1 - s * 0.35 * a);
    R(T, 'armL', -1.5, 0, 0.12); R(T, 'armR', -1.5, 0, -0.12);
    Rx(T, 'torso', 0.55); Rx(T, 'head', -0.25); Py(T, 'root', Math.abs(Math.cos(ph)) * 0.01);
    P(T, 'torso', 0, 0, 0.0);
  },
  roll: (T, t, ph) => {
    const s = Math.sin(ph);
    Rx(T, 'legL', -0.3 + s * 0.4); Rx(T, 'legR', 0.1 - s * 0.4);
    R(T, 'armL', -1.6, 0, 0.5); R(T, 'armR', -1.6, 0, -0.5);
    Rx(T, 'torso', 0.5); Rx(T, 'head', -0.2);
  },
  wave: (T, t) => {
    breathe(T, t);
    R(T, 'armR', 0.0, 0, -2.45 + Math.sin(t * 9) * 0.3); Rz(T, 'torso', Math.sin(t * 3) * 0.04);
    Ry(T, 'head', 0.25 + Math.sin(t * 1.3) * 0.1);
  },
  camwave: (T, t) => {
    R(T, 'armR', 0.0, 0, -2.5 + Math.sin(t * 9) * 0.35); R(T, 'armL', 0.0, 0, 2.2 + Math.sin(t * 8 + 1) * 0.3);
    Py(T, 'root', Math.abs(Math.sin(t * 4.5)) * 0.02); Ry(T, 'head', Math.sin(t * 1.5) * 0.15); Rx(T, 'head', -0.1);
  },
  sit: (T, t) => {
    Py(T, 'hips', -0.115); Rx(T, 'legL', -1.5); Rx(T, 'legR', -1.5); Rz(T, 'legL', 0.1); Rz(T, 'legR', -0.1);
    R(T, 'armL', -0.5, 0, 0.35); R(T, 'armR', -0.5, 0, -0.35); Rx(T, 'torso', -0.12); Ry(T, 'head', Math.sin(t * 0.6) * 0.3);
  },
  nap: (T, t, ph, a) => {
    const breath = Math.sin(t * 1.6);
    Py(T, 'hips', -0.115); Rx(T, 'legL', -1.45); Rx(T, 'legR', -1.5); Rz(T, 'legL', 0.2); Rz(T, 'legR', -0.15);
    R(T, 'armL', -0.9, 0, 0.1); R(T, 'armR', -0.9, 0, -0.1);
    Rx(T, 'torso', -0.25 + breath * 0.02); R(T, 'head', 0.55 + breath * 0.03, 0.2, 0.2 * (1 - a));
  },
  surf: (T, t, ph, a) => {
    const w = Math.sin(t * 1.8), w2 = Math.sin(t * 2.7 + 1);
    crouch(T, 0.55); Rz(T, 'legL', 0.3); Rz(T, 'legR', -0.3);
    Rx(T, 'torso', 0.3 + 0.08 * w); Rz(T, 'torso', 0.12 * w2);
    R(T, 'armL', -0.2 + 0.2 * w, 0, 1.3 + 0.2 * w2); R(T, 'armR', -0.2 - 0.2 * w, 0, -1.3 - 0.2 * w2);
    Ry(T, 'head', 0.4); Rx(T, 'head', -0.1);
  },
  fish: (T, t, ph, a) => {
    const reel = Math.sin(t * 6) * a;
    R(T, 'armR', -1.15 - 0.15 * (1 - a), 0, -0.1); R(T, 'armL', -1.05 + 0.1 * reel, 0, 0.3);
    Rx(T, 'torso', 0.12 - 0.12 * a); Rx(T, 'head', 0.2); Ry(T, 'head', Math.sin(t * 0.8) * 0.15); show(T, 'tRod');
    Py(T, 'root', Math.sin(t * 2) * 0.003);
  },
  mop: (T, t) => {
    const s = Math.sin(t * 3.6);
    crouch(T, 0.12); R(T, 'armR', -0.95, s * 0.2, -0.25 + s * 0.3); R(T, 'armL', -0.9, 0, 0.35 + s * 0.3);
    Rx(T, 'torso', 0.3); Ry(T, 'torso', s * 0.45); Rx(T, 'head', 0.3); show(T, 'tMop');
  },
  flinch: (T, t, ph, a) => {
    const j = Math.sin(t * 45) * 0.008 * (1 - sm(a));
    crouch(T, 0.85); Rx(T, 'torso', 0.75); R(T, 'armL', -2.5, 0, 0.5); R(T, 'armR', -2.5, 0, -0.5); Rx(T, 'head', 0.55);
    P(T, 'root', j, 0, 0); Rx(T, 'visor', 0.0);
  },
  peek: (T, t, ph, a) => {
    crouch(T, 0.35); Rx(T, 'torso', 0.25); Rz(T, 'torso', 0.22); R(T, 'head', -0.15, 0.55, -0.15);
    R(T, 'armL', -2.25, 0, 0.25); R(T, 'armR', -0.4, 0, -0.5); Rx(T, 'visor', -0.7 - Math.sin(t * 3) * 0.05);
  },
  celebrate: (T, t) => {
    const j = Math.abs(Math.sin(t * 6.5));
    Py(T, 'root', j * 0.09);
    R(T, 'armL', -0.5 + Math.sin(t * 13) * 0.4, 0, 2.5); R(T, 'armR', -0.5 - Math.sin(t * 13) * 0.4, 0, -2.5);
    Rx(T, 'legL', -0.5 * (1 - j)); Rx(T, 'legR', 0.4 * (1 - j)); Rx(T, 'head', -0.2); Rx(T, 'torso', -0.1);
  },
  tada: (T, t) => {
    breathe(T, t);
    R(T, 'armL', -0.2, 0, 2.1 + Math.sin(t * 4) * 0.08); R(T, 'armR', -0.2, 0, -2.1 - Math.sin(t * 4) * 0.08);
    Rx(T, 'head', -0.25); Rx(T, 'torso', -0.1); Py(T, 'root', 0.01 + Math.sin(t * 4) * 0.006);
  },
  shades: (T, t, ph, a) => {
    // a: 0..1 hand to the face and back, with the sunglasses on from the middle
    const up = Math.sin(Math.min(1, a * 1.6) * Math.PI);
    breathe(T, t);
    R(T, 'armR', -2.35 * up, 0, -0.45 * up - 0.1 * (1 - up) + (a > 0.5 ? -0.5 * sm((a - 0.6) * 4) : 0));
    Rz(T, 'armL', 0.15 + 0.5 * sm((a - 0.6) * 4)); Rx(T, 'head', -0.12 * sm((a - 0.5) * 3));
    if (a > 0.45) show(T, 'tShades', sm((a - 0.45) * 8));
  },
  selfie: (T, t, ph, a) => {
    R(T, 'armR', -2.35, 0, -0.35); R(T, 'armL', -0.4, 0, 2.3 + Math.sin(t * 5) * 0.12);
    Rz(T, 'head', 0.15); Ry(T, 'head', -0.25); Rx(T, 'torso', -0.1); show(T, 'tPhone'); Py(T, 'root', Math.sin(t * 2) * 0.004);
    Rz(T, 'torso', -0.06);
  },
  throw: (T, t, ph, a) => {
    const k = sm(a);
    Rx(T, 'armR', 0.9 - 3.1 * k); Rz(T, 'armR', -0.2); R(T, 'armL', -0.9 * (1 - k) - 0.3, 0, 0.5);
    Ry(T, 'torso', -0.55 + 1.0 * k); Rx(T, 'torso', 0.1 + 0.2 * k); Rx(T, 'legL', -0.35 * k); Rx(T, 'legR', 0.25 * (1 - k));
  },
  catch: (T, t, ph, a) => {
    R(T, 'armL', -1.45, 0, 0.2); R(T, 'armR', -1.45, 0, -0.2); Rx(T, 'head', 0.1); Rx(T, 'torso', 0.12);
    crouch(T, 0.2 * sm(a)); P(T, 'root', 0, Math.sin(t * 3) * 0.003, 0);
  },
  plant: (T, t) => {
    const s = Math.sin(t * 5);
    crouch(T, 0.8); Rx(T, 'torso', 0.55); R(T, 'armR', -1.4 - 0.25 * s, 0, -0.15); R(T, 'armL', -1.1, 0, 0.3); Rx(T, 'head', 0.3);
  },
  flag: (T, t) => {
    R(T, 'armR', -2.75, 0, -0.1 + Math.sin(t * 3) * 0.05); R(T, 'armL', -0.2, 0, 2.3 + Math.sin(t * 8) * 0.3);
    Rx(T, 'head', -0.2); Py(T, 'root', Math.abs(Math.sin(t * 3.2)) * 0.015); show(T, 'tFlag');
  },
  lookup: (T, t, ph, a) => {
    Rx(T, 'head', -0.7); Rx(T, 'torso', -0.12); R(T, 'armR', -2.7 * sm(a), 0, -0.2); R(T, 'armL', 0.0, 0, 0.3);
    Py(T, 'root', Math.sin(t * 2) * 0.003);
  },
  point: (T, t, ph, a) => {
    breathe(T, t); R(T, 'armR', -1.55, 0, -0.1); Ry(T, 'head', 0.2);
  },
  soaked: (T, t, ph, a) => {
    const d = Math.max(0, 1 - a);
    Ry(T, 'torso', Math.sin(t * 32) * 0.35 * a); R(T, 'armL', -0.2, 0, 0.9 + Math.sin(t * 32) * 0.3 * a); R(T, 'armR', -0.2, 0, -0.9 - Math.sin(t * 32) * 0.3 * a);
    Ry(T, 'head', Math.sin(t * 34) * 0.5 * a); Rx(T, 'head', 0.2 * d); Py(T, 'root', Math.abs(Math.sin(t * 16)) * 0.012 * a);
  },
  startle: (T, t, ph, a) => {
    Py(T, 'root', Math.sin(Math.min(1, a) * Math.PI) * 0.1); R(T, 'armL', -0.4, 0, 1.9); R(T, 'armR', -0.4, 0, -1.9); Rx(T, 'head', -0.3);
    Rx(T, 'legL', -0.4); Rx(T, 'legR', 0.4);
  },
  eat: (T, t) => {
    const c = Math.sin(t * 9);
    R(T, 'armL', -2.0, 0, 0.45); R(T, 'armR', -2.0, 0, -0.45); Rx(T, 'head', 0.05 + c * 0.06); Py(T, 'root', Math.abs(Math.sin(t * 4)) * 0.01);
  },
  slump: (T, t) => {
    Rx(T, 'head', 0.55); Rx(T, 'torso', 0.18); Rz(T, 'armL', 0.06); Rz(T, 'armR', -0.06); Py(T, 'root', -0.01);
  },
};

/** Evaluate the pose into the target, then ease the current values toward it and drive the bones. */
export function applyPose(ch: Character, ps: PoseState, dt: number) {
  const T = ps.tgt, C = ps.cur;
  T.set(DEF);
  POSES[ps.pose](T, ps.t, ps.ph, ps.a, ps.b);
  const k = 1 - Math.exp(-dt * ps.rate);
  const bones = ch.bones, head = ch.skin.build.head;
  for (let i = 0; i < NB; i++) {
    const o = i * S;
    for (let j = 0; j < S; j++) C[o + j] += (T[o + j] - C[o + j]) * k;
    const b = bones[i];
    b.rotation.set(C[o], C[o + 1], C[o + 2]);
    b.position.set(REST_LOCAL[i * 3] + C[o + 3], REST_LOCAL[i * 3 + 1] + C[o + 4], REST_LOCAL[i * 3 + 2] + C[o + 5]);
    const sc = C[o + 6] < 0.003 ? 0 : C[o + 6];
    b.scale.setScalar(i === B.head ? sc * head : sc);
  }
  ps.t += dt;
}

/** Make a fresh pose take over at once (no easing), for a character that pops in. */
export function snapPose(ps: PoseState) { ps.cur.set(ps.tgt); }
export const BONE_COUNT = BONES.length;
