// Flying over the 3D board (experimental), as pure maths: a drone-like camera that accelerates and glides to a stop,
// turns (yaw) and tilts (pitch) its gimbal, climbs and descends, banks gently into turns, and stays inside a radius
// around the board, below a ceiling and above everything on the board. The floor under the camera is a smooth field
// over the hexes and their models (the tallest point within each hex, with a soft ramp around it), so the camera rises
// over a tower as it nears it instead of passing through, and never jumps at a hex edge.
import type {FlyInput} from '../../../../shared/fly';
import {NO_INPUT} from '../../../../shared/fly';

/** Something on the board the camera keeps above: a hex (and what stands on it) of radius r, `top` high. */
export type Obstacle = {x: number; z: number; r: number; top: number};

export type FlyBounds = {
  /** the board's centre, and how far from it the camera may go (world units, horizontally): `radius` down at the
   *  board, widening to `radiusTop` at the ceiling (so the resting view's spot, high and well back, is inside) */
  cx: number; cz: number; radius: number; radiusTop?: number;
  /** the highest the camera may fly */
  ceiling: number;
  /** the least room between the camera and anything under it */
  clearance: number;
  obstacles: readonly Obstacle[];
};

export type FlyState = {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  /** heading: 0 looks toward -z (the far rows, as the resting camera does); positive turns left */
  yaw: number;
  /** gimbal: 0 level, negative looks down */
  pitch: number;
  yawRate: number; pitchRate: number;
  /** roll into turns, radians */
  bank: number;
};

export type FlyOptions = {
  /** reduced motion: the camera moves only while a control is held (no glide, no banking) */
  reduced?: boolean;
  /** gentle banking into turns */
  bank?: boolean;
  /** the speed the pilot picked (the mouse wheel): a factor on the base speed */
  speed?: number;
};

export const FLY = {
  /** base horizontal speed, as a fraction of the flight radius per second (higher up, faster: see speedAt) */
  speed: 0.32,
  boost: 2.4,
  /** climb speed, as a fraction of the ceiling per second */
  climb: 0.22,
  yawRate: 1.3, pitchRate: 0.9,
  /** how quickly velocity follows the sticks (per second), and how quickly it dies away when they are let go */
  accel: 3.2, damping: 1.9, turnAccel: 7, turnDamping: 5,
  pitchMin: -1.45, pitchMax: 0.15,
  bankMax: 0.14,
  /** the floor's soft ramp around each obstacle, in multiples of the clearance */
  ramp: 2.2,
  /** how far ahead (seconds of travel) the floor is felt, so the camera starts rising before a tower */
  lookAhead: 0.35,
  speedRange: [0.4, 2.5] as const,
} as const;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const smooth = (e0: number, e1: number, x: number) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };

/** A stick value with a dead zone, rescaled so it still reaches 1. */
export function deadzone(v: number, dz = 0.15): number {
  const a = Math.abs(v);
  return a <= dz ? 0 : Math.sign(v) * Math.min(1, (a - dz) / (1 - dz));
}

/** Several controls at once (keys, a gamepad, a phone): their sum, each axis held to -1..1; the largest boost. */
export function mixInputs(...inputs: Array<FlyInput | null | undefined>): FlyInput {
  const o = {...NO_INPUT};
  for (const i of inputs) {
    if (!i) continue;
    o.mx += i.mx; o.my += i.my; o.lx += i.lx; o.ly += i.ly; o.lift += i.lift;
    o.boost = Math.max(o.boost, i.boost);
  }
  return {mx: clamp(o.mx, -1, 1), my: clamp(o.my, -1, 1), lx: clamp(o.lx, -1, 1), ly: clamp(o.ly, -1, 1), lift: clamp(o.lift, -1, 1), boost: clamp(o.boost, 0, 1)};
}

/** How high the floor is at (x, z): the highest obstacle within its radius plus the clearance, easing to nothing over
 *  the ramp beyond. Smooth everywhere, never under the plate. */
export function floorAt(x: number, z: number, b: FlyBounds): number {
  let f = 0;
  const c = b.clearance, ramp = c * FLY.ramp;
  for (const o of b.obstacles) {
    const d = Math.hypot(x - o.x, z - o.z);
    const inner = o.r + c;
    if (d >= inner + ramp || o.top <= f) continue;
    const w = d <= inner ? 1 : 1 - smooth(inner, inner + ramp, d);
    f = Math.max(f, o.top * w);
  }
  return f;
}

/** The lowest the camera may fly at (x, z). */
export const minAltitude = (x: number, z: number, b: FlyBounds) => floorAt(x, z, b) + b.clearance;

/** Faster high up, slower and more precise down among the tiles. */
export function speedAt(alt: number, b: FlyBounds): number {
  return clamp(0.35 + (alt / Math.max(1e-6, b.ceiling)) * 2.2, 0.35, 1.6);
}

/** The camera's look direction for a heading and gimbal angle. */
export function lookDir(yaw: number, pitch: number): [number, number, number] {
  const c = Math.cos(pitch);
  return [-Math.sin(yaw) * c, Math.sin(pitch), -Math.cos(yaw) * c];
}

/** A flight starting where the camera is, looking where it looks. */
export function flyFrom(pos: readonly [number, number, number], dir: readonly [number, number, number]): FlyState {
  const l = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  const [dx, dy, dz] = [dir[0] / l, dir[1] / l, dir[2] / l];
  return {x: pos[0], y: pos[1], z: pos[2], vx: 0, vy: 0, vz: 0, yaw: Math.atan2(-dx, -dz), pitch: clamp(Math.asin(clamp(dy, -1, 1)), FLY.pitchMin, FLY.pitchMax),
    yawRate: 0, pitchRate: 0, bank: 0};
}

/** Holds a position inside the bounds: within the radius, under the ceiling, above the floor (with velocity into a
 *  wall removed). The floor is soft: the camera is lifted toward it quickly, and never left below half the clearance. */
/** How far from the centre the camera may be at height y. */
export function radiusAt(y: number, b: FlyBounds): number {
  const top = b.radiusTop ?? b.radius;
  return b.radius + (top - b.radius) * clamp(y / Math.max(1e-6, b.ceiling), 0, 1);
}

export function confine(s: FlyState, b: FlyBounds, dt: number): FlyState {
  const o = {...s};
  if (o.y > b.ceiling) { o.y = b.ceiling; if (o.vy > 0) o.vy = 0; }
  const dx = o.x - b.cx, dz = o.z - b.cz, r = Math.hypot(dx, dz), R = radiusAt(o.y, b);
  if (r > R) {
    const k = R / r;
    o.x = b.cx + dx * k; o.z = b.cz + dz * k;
    // drop the outward part of the velocity
    const nx = dx / r, nz = dz / r, out = o.vx * nx + o.vz * nz;
    if (out > 0) { o.vx -= out * nx; o.vz -= out * nz; }
  }
  // feel the floor a little ahead, so a tower lifts the camera before it arrives
  const ahead = Math.min(FLY.lookAhead, 0.6);
  const floor = Math.max(minAltitude(o.x, o.z, b), minAltitude(o.x + o.vx * ahead, o.z + o.vz * ahead, b));
  if (o.y < floor) {
    o.y += (floor - o.y) * (1 - Math.exp(-14 * dt));
    if (o.vy < 0) o.vy = 0;
    const hard = floorAt(o.x, o.z, b) + b.clearance * 0.5;
    if (o.y < hard) o.y = hard;
  }
  return o;
}

/** One frame of flight. `look` adds direct angle changes (a mouse drag), in radians. */
export function stepFlight(s: FlyState, input: FlyInput, look: {yaw: number; pitch: number}, dtIn: number, b: FlyBounds, opt: FlyOptions = {}): FlyState {
  const dt = clamp(dtIn, 0, 0.1);
  const o = {...s};
  const reduced = !!opt.reduced;
  // turning: rates follow the sticks with a little inertia (none under reduced motion)
  const follow = (cur: number, want: number, held: boolean) => (reduced ? want : cur + (want - cur) * (1 - Math.exp(-(held ? FLY.turnAccel : FLY.turnDamping) * dt)));
  o.yawRate = follow(o.yawRate, -input.lx * FLY.yawRate, Math.abs(input.lx) > 0.01);
  o.pitchRate = follow(o.pitchRate, input.ly * FLY.pitchRate, Math.abs(input.ly) > 0.01);
  o.yaw += o.yawRate * dt + look.yaw;
  o.pitch = clamp(o.pitch + o.pitchRate * dt + look.pitch, FLY.pitchMin, FLY.pitchMax);
  // moving: like a drone, level with the ground whatever the gimbal looks at
  const alt = o.y - floorAt(o.x, o.z, b);
  const sp = FLY.speed * b.radius * speedAt(alt, b) * clamp(opt.speed ?? 1, FLY.speedRange[0], FLY.speedRange[1]) * (1 + (FLY.boost - 1) * input.boost);
  const fx = -Math.sin(o.yaw), fz = -Math.cos(o.yaw), rx = Math.cos(o.yaw), rz = -Math.sin(o.yaw);
  const wx = (fx * input.my + rx * input.mx) * sp, wz = (fz * input.my + rz * input.mx) * sp;
  const wy = input.lift * FLY.climb * b.ceiling * (1 + (FLY.boost - 1) * input.boost * 0.5);
  const moving = Math.abs(input.mx) + Math.abs(input.my) > 0.01, climbing = Math.abs(input.lift) > 0.01;
  if (reduced) { o.vx = wx; o.vz = wz; o.vy = wy; }
  else {
    const kh = 1 - Math.exp(-(moving ? FLY.accel : FLY.damping) * dt), kv = 1 - Math.exp(-(climbing ? FLY.accel : FLY.damping) * dt);
    o.vx += (wx - o.vx) * kh; o.vz += (wz - o.vz) * kh; o.vy += (wy - o.vy) * kv;
    // a glide that has nearly stopped stops
    if (!moving && Math.hypot(o.vx, o.vz) < sp * 0.004) { o.vx = 0; o.vz = 0; }
    if (!climbing && Math.abs(o.vy) < b.ceiling * 0.0005) o.vy = 0;
  }
  o.x += o.vx * dt; o.y += o.vy * dt; o.z += o.vz * dt;
  // banking: into the turn and the sideways drift, gently
  if (opt.bank && !reduced) {
    const side = (o.vx * rx + o.vz * rz) / Math.max(1e-6, FLY.speed * b.radius * 1.6);
    const want = clamp(o.yawRate * 0.1 - side * 0.09, -FLY.bankMax, FLY.bankMax);
    o.bank += (want - o.bank) * (1 - Math.exp(-3 * dt));
  } else o.bank += (0 - o.bank) * (reduced ? 1 : 1 - Math.exp(-4 * dt));
  return confine(o, b, dt);
}

/** The near clipping distance for a camera this high over the floor: close enough that nothing it can reach is cut,
 *  far enough to keep depth precision for the stacked hex tops. */
export function nearFor(heightOverFloor: number, clearance: number): number {
  return clamp(Math.min(heightOverFloor, clearance) * 0.5, 0.03, 0.5);
}

// ---- the TV's controls as inputs -----------------------------------------------------------------------------------
/** The keys held now, as one input. */
export function keysInput(held: ReadonlySet<string>): FlyInput {
  const k = (c: string) => (held.has(c) ? 1 : 0);
  return {my: k('KeyW') + k('ArrowUp') - k('KeyS') - k('ArrowDown'), mx: k('KeyD') - k('KeyA'), lx: k('ArrowRight') - k('ArrowLeft'),
    ly: k('KeyT') - k('KeyG'), lift: k('KeyE') + k('PageUp') - k('KeyQ') - k('PageDown'), boost: k('ShiftLeft') || k('ShiftRight')};
}

/** A standard-mapping gamepad as an input: left stick moves, right stick looks, the triggers climb (right) and descend
 *  (left), a bumper or a stick press boosts. */
export function padInput(p: Pick<Gamepad, 'axes' | 'buttons'>): FlyInput {
  const ax = (i: number) => deadzone(p.axes[i] ?? 0);
  const b = (i: number) => p.buttons[i]?.value ?? (p.buttons[i]?.pressed ? 1 : 0);
  return {mx: ax(0), my: -ax(1), lx: ax(2), ly: -ax(3), lift: b(7) - b(6), boost: Math.max(b(4), b(5), b(10)) > 0.5 ? 1 : 0};
}

// ---- when a flight ends on its own -------------------------------------------------------------------------------
export const FLY_IDLE_MS = 60_000;
export type LandReason = 'idle' | 'placing' | 'show';

/** Whether the flight should hand the board back: a minute without input, someone choosing a space for a tile (the
 *  board must be readable), or the production show starting. */
export function landReason(o: {now: number; lastInput: number; placing: boolean; show: boolean}): LandReason | null {
  if (o.placing) return 'placing';
  if (o.show) return 'show';
  if (o.now - o.lastInput >= FLY_IDLE_MS) return 'idle';
  return null;
}

/** Eases a landing (0..1 over its time): the height leads (rises early), so the path climbs before it travels. */
export function landEase(t: number): {xz: number; y: number; turn: number} {
  const k = clamp(t, 0, 1);
  const io = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
  return {xz: io, y: 1 - (1 - k) ** 3, turn: io};
}
