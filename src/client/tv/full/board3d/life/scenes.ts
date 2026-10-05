// The scenes: six ambient vignettes, ten reactions, five things from the sky. Each is a function of its own clock `t`
// (seconds since its characters arrived), so it needs no state beyond a few scratch numbers, never allocates, and can be
// held at one moment for reduced motion. Every vignette ends on a punchline beat. Coordinates are world units; a
// character is H (about 0.2) tall and a hex is about 0.95 across.
import * as THREE from 'three';
import type {CharState, Scene, SceneDef, LifeWorld} from './world';
import type {PoseId} from './anim';
import {CHAR_H} from './props';
import type {AmbientKind, FallKind} from './scheduler';
import type {ReactionKind} from './reactions';

const H = CHAR_H;
/** True on the one frame in which the scene's clock passes `at`. */
const crossed = (S: Scene, t: number, at: number) => S.tp < at && t >= at;
const sm = (x: number) => { const c = Math.min(1, Math.max(0, x)); return c * c * (3 - 2 * c); };
const ramp = (t: number, a: number, b: number) => sm((t - a) / (b - a));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const back = (x: number) => { const c1 = 1.9, c3 = c1 + 1, m = Math.min(1, Math.max(0, x)) - 1; return 1 + c3 * m * m * m + c1 * m * m; };
const PI = Math.PI;
const DUST = 0xe6c8b0, WHITE = 0xffffff, DROP = 0x7cc8ff, SPARK = 0xffe27a, LAVA = 0xff7a30, SMOKE = 0xa39a94;
const ZZ = ['zzA', 'zzB', 'zzC'], CV = ['cvA', 'cvB', 'cvC', 'cvD'], FLASHES = [2.8, 5.0, 7.7], CHEERS = [0.8, 3.4, 6.7];
const CONFETTI = [0xff5a5f, 0xffc233, 0x3ddc97, 0x4aa8ff, 0xff7ad9];

/** Set a character's pose; the pose's clock restarts when the pose changes. */
function pose(c: CharState, id: PoseId, a = 0, b = 0) {
  if (c.ps.pose !== id) { c.ps.pose = id; c.ps.t = 0; }
  c.ps.a = a; c.ps.b = b;
}
const OFF = {x: 0, z: 0};
/** Rotate an offset (dx forward-right, dz forward) by yaw into OFF. */
function off(yaw: number, dx: number, dz: number) { const s = Math.sin(yaw), c = Math.cos(yaw); OFF.x = dx * c + dz * s; OFF.z = -dx * s + dz * c; }
const puff = (W: LifeWorld, x: number, y: number, z: number, n = 4, size = H * 0.07, color = DUST) => W.parts.burst(x, y, z, n, 0.08, 0.06, 0.7, size, color, -0.1, 1);
const sparkle = (W: LifeWorld, x: number, y: number, z: number, n = 6, color = SPARK) => W.parts.burst(x, y, z, n, 0.12, 0.14, 0.55, H * 0.04, color, 1.5, 1);
const confetti = (W: LifeWorld, x: number, y: number, z: number, n = 14, floor = -1e9) => {
  for (let k = 0; k < n; k++) { const a = k * 2.4; W.parts.emit(x, y, z, Math.sin(a) * 0.16 * (0.4 + (k % 4) / 5), 0.3 + (k % 5) * 0.04, Math.cos(a) * 0.16 * (0.4 + (k % 3) / 4), 1.5, H * 0.045, CONFETTI[k % 5], 1.0, 0.6, floor); }
};

function basicSite(W: LifeWorld, S: Scene, spot: (S: Scene) => void, want = {}): boolean {
  const h = W.siteFor(want);
  if (h === null) return false;
  W.setSite(S, h);
  spot(S);
  return true;
}

// ================================================================================================================
// ambient vignettes
// ================================================================================================================

/** Plants a seedling; a gust blows it away. */
const plant: SceneDef = {
  kind: 'plant', chars: 1, dur: 11, priority: 1, punch: 5.4, uses: ['sprout', 'gust', 'mound'], tableau: 4,
  site: (W, S) => basicSite(W, S, (s) => { s.spots[0] = {x: s.x - 0.05, z: s.z + 0.08, yaw: 0.4}; }),
  play: (W, S, t, dt) => {
    const c = S.chars[0], rig = W.rig, y = S.y;
    off(0.4, 0, H * 0.55);
    const sx = S.spots[0].x + OFF.x, sz = S.spots[0].z + OFF.z;
    // the mound, then the sprout springing up from it
    const mb = rig.put('mound', sx, y, sz, 0, 1);
    mb.scale.set(Math.max(0.001, ramp(t, 0.4, 1.4)), 1, Math.max(0.001, ramp(t, 0.4, 1.4)));
    const grow = Math.max(0, back((t - 2.4) / 1.3));
    // the gust comes in from the right, then carries the sprout off to the left
    const gust = t > 5.0 && t < 8.6;
    const gx = t < 6.3 ? lerp(sx + 0.4, sx - 0.02, ramp(t, 5.0, 6.3)) : sx - 0.02 - 0.5 * Math.pow(ramp(t, 6.3, 8.6), 2);
    const lift = t > 6.3 ? Math.pow(ramp(t, 6.3, 8.6), 2) : 0;
    if (gust) {
      const g = rig.put('gust', gx, y + 0.02 + lift * 0.25, sz + (t > 6.3 ? Math.sin(t * 9) * 0.04 : 0), 0, 1.2);
      g.rotation.y = t * 14;
      if (W.rnd() < dt * 18) W.parts.emit(gx, y + 0.03 + lift * 0.25, sz, -0.15, 0.04, (W.rnd() - 0.5) * 0.1, 0.6, H * 0.04, DUST, 0, 1);
    } else rig.hide('gust');
    if (t > 2.4 && t < 8.6) {
      const sway = t > 3.8 && t < 5.4 ? Math.sin(t * 5) * 0.07 * ramp(t, 4.6, 5.4) : 0;
      const b = rig.put('sprout', t > 6.3 ? gx : sx, y + 0.02 * lift + 0.25 * lift, t > 6.3 ? sz + Math.sin(t * 9) * 0.04 : sz, 0, 1);
      b.scale.set(0.9 * (1 - lift * 0.5), Math.max(0.001, 0.9 * grow * (1 - lift * 0.5)), 0.9 * (1 - lift * 0.5));
      b.rotation.set(lift * 9, lift * 14, sway);
    } else rig.hide('sprout');
    if (t < 3.6) { pose(c, 'plant'); W.setFace(c, 'neutral'); }
    else if (t < 5.2) { pose(c, 'tada'); W.setFace(c, 'happy'); if (crossed(S, t, 3.6)) sparkle(W, sx, y + 0.06, sz, 5, 0x9dff7a); }
    else if (t < 6.3) { pose(c, 'startle', ramp(t, 5.2, 5.9)); W.setFace(c, 'surprised'); }
    else if (t < 8.6) { pose(c, 'lookup', ramp(t, 6.4, 7.2)); W.setFace(c, 'surprised'); }
    else { pose(c, 'slump'); W.setFace(c, 'sleepy'); }
    if (crossed(S, t, 8.5)) puff(W, sx, y + 0.01, sz, 3);
  },
};

/** Drills a hole; a water burst soaks the driller. */
const drill: SceneDef = {
  kind: 'drill', chars: 1, dur: 13.5, priority: 1, punch: 6.6, uses: ['rigBase', 'hole', 'geyser'], tableau: 3,
  site: (W, S) => basicSite(W, S, (s) => { s.spots[0] = {x: s.x + 0.1, z: s.z + 0.05, yaw: -0.85}; }),
  play: (W, S, t, dt) => {
    const c = S.chars[0], rig = W.rig, y = S.y;
    const rx = S.x - 0.04, rz = S.z;
    const shake = ramp(t, 3.5, 6.4) * 0.006;
    rig.put('rigBase', rx + Math.sin(t * 50) * shake, y, rz + Math.cos(t * 43) * shake, 0.6, 1);
    const down = ramp(t, 0.6, 5.6);
    const bit = rig.bone('rigBit'); bit.position.y = H * (0.4 - 0.34 * down * (t < 6.4 ? 1 : 1 - ramp(t, 6.4, 6.8)));
    bit.rotation.y = t * 18;
    rig.bone('rigCrank').rotation.z = Math.sin(t * 5) * 0.5;
    rig.put('hole', rx, y, rz, 0, ramp(t, 0.9, 2.2) * 1.0 + 0.001);
    if (t > 1 && W.rnd() < dt * 8 && t < 6.4) puff(W, rx, y + 0.01, rz, 1, H * 0.05);
    // the burst
    const gt = t - 6.4;
    if (gt > 0 && gt < 3.6) {
      const k = gt < 0.5 ? sm(gt / 0.5) : gt < 2.6 ? 1 - 0.1 * Math.sin(gt * 20) : 1 - sm((gt - 2.6) / 1.0);
      const gb = rig.put('geyser', rx, y, rz, 0, Math.max(0.001, 2.0));
      gb.scale.set(1.7 * (0.7 + 0.3 * k), Math.max(0.001, 1.5 * k), 1.7 * (0.7 + 0.3 * k));
      if (W.rnd() < dt * 40) { const a = W.rnd() * PI * 2; W.parts.emit(rx, y + H * 1.5 * k, rz, Math.sin(a) * 0.1 + (c.x - rx) * 0.45, 0.1, Math.cos(a) * 0.1 + (c.z - rz) * 0.45, 1.0, H * 0.045, DROP, 2.4, 0.4, y); }
    } else rig.hide('geyser');
    // the driller
    if (t < 5.6) { pose(c, 'pump'); W.setFace(c, 'neutral'); }
    else if (t < 6.4) { pose(c, 'peek', 0); W.setFace(c, 'surprised'); }
    else if (t < 7.0) { pose(c, 'startle', ramp(t, 6.4, 6.9)); W.setFace(c, 'surprised'); }
    else if (t < 10.0) { pose(c, 'soaked', ramp(t, 7.0, 7.4) * (1 - ramp(t, 9.0, 10.0)) + 0.001); W.setFace(c, 'surprised'); if (t < 9.5 && W.rnd() < dt * 12) W.parts.emit(c.x + (W.rnd() - 0.5) * H * 0.4, c.y + H * 0.9, c.z + (W.rnd() - 0.5) * H * 0.4, 0, 0, 0, 0.7, H * 0.03, DROP, 1.5, 0.3, c.y); }
    else if (t < 11.8) { pose(c, 'slump'); W.setFace(c, 'sleepy'); if (W.rnd() < dt * 5) W.parts.emit(c.x + (W.rnd() - 0.5) * H * 0.5, c.y + H * 0.6, c.z + H * 0.1, 0, 0, 0, 0.6, H * 0.03, DROP, 2, 0.3, c.y); }
    else { pose(c, 'tada'); W.setFace(c, 'happy'); }
  },
};

/** Pushes a stuck mini rover; it pops free and drives off without them. */
const rover: SceneDef = {
  kind: 'rover', chars: 1, dur: 13, priority: 1, punch: 6.8, uses: ['rvRover', 'rock'], tableau: 2,
  site: (W, S) => basicSite(W, S, (s) => { s.spots[0] = {x: s.x - 0.17, z: s.z + 0.03, yaw: 1.0}; }),
  play: (W, S, t, dt) => {
    const c = S.chars[0], rig = W.rig, y = S.y;
    const x0 = S.x - 0.05, z0 = S.z;
    let adv = 0, spin = 0;
    const pop = t - 6.6;
    if (t < 6.6) { adv = 0.004 * Math.sin(t * 9) * ramp(t, 0.5, 2); spin = 10; }
    else adv = 0.3 * (1 - Math.exp(-pop * 1.6)) * (pop < 3.5 ? 1 : 1);
    if (pop > 0 && pop < 3) spin = 14 * Math.exp(-pop * 0.5);
    const hop = pop > 0 && pop < 0.35 ? Math.sin((pop / 0.35) * PI) * 0.03 : 0;
    const bump = t < 6.6 ? Math.abs(Math.sin(t * 9)) * 0.004 * ramp(t, 0.5, 2) : 0;
    const rb = rig.put('rvRover', x0 + adv, y + hop + bump, z0, 0, 1);
    rb.rotation.z = t < 6.6 ? Math.sin(t * 9) * 0.03 : 0;
    rig.put('rock', x0 + 0.075, y, z0 + 0.012, 0.8, 0.9);
    S.n0 += spin * dt;
    rig.bone('rvAxF').rotation.z = -S.n0; rig.bone('rvAxR').rotation.z = -S.n0;
    rig.bone('rvDish').rotation.y = t * 1.2;
    if (t < 6.6 && W.rnd() < dt * 5 * ramp(t, 0.4, 1.5)) puff(W, x0 - 0.04, y + 0.01, z0 + 0.04, 1, H * 0.06);
    if (pop > 0 && pop < 1.4 && W.rnd() < dt * 22) puff(W, x0 + adv - 0.06, y + 0.012, z0, 1, H * 0.07);
    if (crossed(S, t, 6.6)) { W.parts.burst(x0 + 0.04, y + 0.02, z0, 8, 0.12, 0.1, 0.6, H * 0.04, ROCKDUST, 2, y); }
    // the pusher
    if (t < 6.6) {
      c.x = x0 + adv - 0.1 + Math.sin(t * 9) * 0.003; c.z = z0 + 0.03;
      c.yaw = c.yawTarget = 1.0; c.ps.ph += dt * (3 + 5 * ramp(t, 0, 3)); pose(c, 'push', 1);
      W.setFace(c, t > 4 ? 'sleepy' : 'neutral');
    } else if (pop < 1.7) {
      // the push is suddenly nothing: forward onto the face
      const k = sm(pop / 0.5);
      c.x += dt * 0.07 * (1 - k) * 2; c.tilt = k * 1.35; c.lift = -0.0; pose(c, 'slump'); W.setFace(c, 'surprised');
    } else if (pop < 3.6) {
      c.tilt = 1.35 * (1 - ramp(pop, 1.7, 2.5)); pose(c, 'slump'); W.setFace(c, 'sleepy');
    } else if (pop < 5.0) { c.tilt = 0; pose(c, 'point'); c.yawTarget = 1.0; W.setFace(c, 'surprised'); }
    else { pose(c, 'wave'); c.yawTarget = 0.3; W.setFace(c, 'happy'); }
  },
};
const ROCKDUST = 0xb09a8a;

/** Mops up a puddle beside an ocean; the ocean sends more, and a rubber duck comes with it. */
const mop: SceneDef = {
  kind: 'mop', chars: 1, dur: 12.5, priority: 1, punch: 6.8, uses: ['puddle', 'bucket', 'duckM'], tableau: 3,
  site: (W, S) => {
    const h = W.siteFor({nextTo: 'ocean'});
    if (h === null) return false;
    W.setSite(S, h);
    if (!W.faceNeighbour(S, W.isOcean)) return false;
    const yaw = 0.55 * Math.atan2(S.dx, S.dz) + 0.45 * W.camYaw(S.x, S.z);
    S.spots[0] = {x: S.x - S.dx * 0.02 - S.dz * 0.1, z: S.z - S.dz * 0.02 + S.dx * 0.1 + 0.03, yaw};
    return true;
  },
  play: (W, S, t, dt) => {
    const c = S.chars[0], rig = W.rig, y = S.y;
    const P = W.grid.pitch, px = S.x + S.dx * P * 0.3 + S.dz * 0.12, pz = S.z + S.dz * P * 0.3 - S.dx * 0.12;
    const shrink = t < 6.5 ? 1 - 0.7 * (t / 6.5) : 0.3;
    const surge = ramp(t, 6.6, 7.4);
    const size = (shrink + surge * 1.0) * (1 - ramp(t, 10.6, 12.2) * 0.4);
    const pb = rig.put('puddle', px, y, pz, 0, Math.max(0.05, size * 1.3));
    pb.scale.y = 1;
    rig.put('bucket', S.x - S.dx * 0.1 - 0.12, y, S.z - S.dz * 0.1 + 0.04, 0.5, 1);
    if (t > 6.5 && t < 7.4 && W.rnd() < dt * 40) W.parts.emit(S.x + S.dx * P * 0.55, y + 0.02, S.z + S.dz * P * 0.55, -S.dx * 0.25 + (W.rnd() - 0.5) * 0.08, 0.2, -S.dz * 0.25 + (W.rnd() - 0.5) * 0.08, 0.8, H * 0.05, DROP, 2, 0.4, y);
    if (t < 6.5) { pose(c, 'mop'); W.setFace(c, 'neutral'); if (W.rnd() < dt * 3) puff(W, px, y + 0.01, pz, 1, H * 0.04, DROP); }
    else if (t < 7.2) { pose(c, 'startle', ramp(t, 6.6, 7.1)); W.setFace(c, 'surprised'); }
    else if (t < 9.4) { pose(c, 'slump'); W.setFace(c, 'sleepy'); }
    else {
      pose(c, 'tada'); W.setFace(c, 'happy');
      const u = ramp(t, 9.4, 10.3);
      off(c.yaw, 0, 0.05);
      const dx = lerp(px, c.x + OFF.x, u), dz = lerp(pz, c.z + OFF.z, u);
      const bounce = t > 10.3 ? Math.abs(Math.sin((t - 10.3) * 6)) * 0.01 * Math.exp(-(t - 10.3)) : 0;
      const d = rig.put('duckM', dx, lerp(y + 0.01, y + H * 1.28, u) + bounce, dz, c.yaw, 0.75);
      d.rotation.x = 0;
      if (crossed(S, t, 9.4)) sparkle(W, px, y + 0.03, pz, 6, 0xcdeeff);
    }
  },
};

/** A selfie with a volcano that burps behind them. */
const selfie: SceneDef = {
  kind: 'selfie', chars: 1, dur: 10.5, priority: 1, punch: 6.2, uses: ['volcano'], tableau: 2.4,
  site: (W, S) => {
    const h = W.siteFor({nextTo: 'volcano'}) ?? W.siteFor();
    if (h === null) return false;
    W.setSite(S, h);
    S.spots[0] = {x: S.x + 0.02, z: S.z + 0.13, yaw: 0.08};
    return true;
  },
  play: (W, S, t, dt) => {
    const c = S.chars[0], rig = W.rig, y = S.y;
    const erupt = ramp(t, 6.0, 6.25) * (1 - ramp(t, 6.4, 7.2));
    const VX = S.x - 0.11, VZ = S.z - 0.06, VS = 3.2;
    const vb = rig.put('volcano', VX, y, VZ, 0, VS);
    vb.scale.y = VS * (1 + 0.14 * erupt);
    if (crossed(S, t, 6.0)) { W.parts.burst(VX, y + 0.27 * H * VS, VZ, 12, 0.16, 0.4, 1.1, H * 0.06, LAVA, 2.2, y); W.parts.burst(VX, y + 0.3 * H * VS, VZ, 6, 0.05, 0.16, 1.6, H * 0.14, SMOKE, -0.1, -0.5); }
    if (t > 3 && t < 6 && W.rnd() < dt * 1.2) W.parts.emit(VX, y + 0.3 * H * VS, VZ, (W.rnd() - 0.5) * 0.02, 0.07, 0, 1.6, H * 0.09, SMOKE, 0, -0.5);
    // the poses and the flashes
    if (t < 6.0) { pose(c, 'selfie'); W.setFace(c, t < 1.4 ? 'neutral' : 'happy'); }
    else if (t < 7.0) { pose(c, 'startle', ramp(t, 6.0, 6.5)); W.setFace(c, 'surprised'); c.ps.b = 0; }
    else if (t < 8.6) { pose(c, 'selfie'); W.setFace(c, 'happy'); }
    else { pose(c, 'celebrate'); W.setFace(c, 'happy'); }
    if (t < 8.6) {
      off(c.yaw, -0.16 * H, 0.62 * H);
      for (const f of FLASHES) if (crossed(S, t, f)) W.parts.burst(c.x + OFF.x, c.y + H * 1.3, c.z + OFF.z, 4, 0.05, 0.03, 0.22, H * 0.05, WHITE, 0, 1);
    }
    
  },
};

/** Naps in a deck chair; a gust takes the umbrella. */
const nap: SceneDef = {
  kind: 'nap', chars: 1, dur: 14, priority: 1, punch: 9.4, uses: ['chair', 'umbrella', 'zzA', 'zzB', 'zzC', 'gust'], tableau: 3.2,
  site: (W, S) => basicSite(W, S, (s) => { s.spots[0] = {x: s.x + 0.0, z: s.z + 0.04, yaw: 0.0}; }),
  play: (W, S, t, dt) => {
    const c = S.chars[0], rig = W.rig, y = S.y;
    rig.put('chair', S.x, y, S.z + 0.04, 0, 1);
    c.x = S.x; c.z = S.z + 0.045; c.lift = 0.03 * H; c.yawTarget = 0.0;
    // the umbrella: stands behind, then the gust takes it
    const take = t - 9.3;
    if (take < 0) {
      const wob = t > 8.2 ? Math.sin(t * 17) * 0.1 * ramp(t, 8.2, 9.3) : 0;
      const ub = rig.put('umbrella', S.x + 0.06, y, S.z - 0.13, 0, 1.55);
      ub.rotation.z = 0.1 + wob; ub.rotation.x = 0.0;
    } else if (take < 3.4) {
      const u = take / 3.4;
      const ub = rig.put('umbrella', S.x + 0.06 - 0.5 * u * u * 1.3, y + 0.12 * Math.sin(u * PI) + 0.12 * u + 0.02, S.z - 0.13 + Math.sin(u * 6) * 0.05, 0, 1.55 * (1 - u * 0.5));
      ub.rotation.set(u * 12, u * 7, 0.12 + u * 6);
    } else rig.hide('umbrella');
    if (t > 8.2 && t < 12.6) {
      const g = rig.put('gust', S.x + 0.34 - Math.max(0, t - 8.2) * 0.22, y + 0.02, S.z - 0.13, 0, 1.0 * (1 - ramp(t, 11.0, 12.6)));
      g.rotation.y = t * 15;
      if (W.rnd() < dt * 14) W.parts.emit(g.position.x, y + 0.03, g.position.z, -0.18, 0.03, (W.rnd() - 0.5) * 0.1, 0.5, H * 0.035, DUST, 0, 1);
    } else rig.hide('gust');
    // zzz
    if (t < 9.3) {
      for (let i = 0; i < 3; i++) {
        const k = ((t * 0.32 + i / 3) % 1);
        const b = rig.put(ZZ[i], c.x + 0.045 + k * 0.05, y + H * (0.95 + k * 0.7), c.z + 0.03, 0, Math.sin(k * PI) * 1.35);
        b.rotation.y = 0.3;
      }
    } else for (let i = 0; i < 3; i++) rig.hide(ZZ[i]);
    // the sleeper
    if (t < 9.3) { pose(c, 'nap', 0); W.setFace(c, 'sleepy'); }
    else if (t < 10.6) { pose(c, 'startle', ramp(t, 9.3, 10.0)); W.setFace(c, 'surprised'); c.lift = 0.03 * H + Math.sin(ramp(t, 9.3, 9.8) * PI) * 0.05; }
    else if (t < 12.2) { pose(c, 'lookup', ramp(t, 10.6, 11.2)); W.setFace(c, 'surprised'); }
    else { pose(c, 'tada'); W.setFace(c, 'happy'); }
    c.ps.rate = 12;
  },
};

// ================================================================================================================
// reactions to the game
// ================================================================================================================

/** Reaction placement: a free hex beside the tile that was placed (ocean or city), or any such tile on the board. */
function besideTile(W: LifeWorld, S: Scene, req: {spaceId?: string} | undefined, next: 'ocean' | 'city'): boolean {
  const pred = next === 'ocean' ? W.isOcean : W.isCity;
  let h: number | null = null;
  if (req?.spaceId) {
    const t = W.grid.byId.get(req.spaceId);
    if (t !== undefined) {
      const around = W.grid.nbr[t].filter((j) => W.free[j] && !W.usedHexes().has(j)).sort((a, b) => (W.grid.cells[a].space.bonus.length - W.grid.cells[b].space.bonus.length) || (W.grid.cells[b].z - W.grid.cells[a].z));
      h = around.length ? around[0] : null;
    }
  }
  if (h === null) h = W.siteFor({nextTo: next});
  if (h === null) return false;
  W.setSite(S, h);
  return W.faceNeighbour(S, pred);
}

/** Surfs a little wave over the shore, and wipes out. */
const surf: SceneDef = {
  kind: 'surf', chars: 1, dur: 11.5, priority: 4, uses: ['pool', 'wave', 'board', 'splash'],
  site: (W, S, req) => {
    if (!besideTile(W, S, req, 'ocean')) return false;
    S.spots[0] = {x: S.x, z: S.z + 0.08, yaw: 0.9};
    return true;
  },
  play: (W, S, t, dt) => {
    const c = S.chars[0], rig = W.rig, y = S.y;
    const cx = S.x, cz = S.z + 0.06;
    rig.put('pool', cx, y, cz, 0, ramp(t, 0, 0.8) * 0.62 + 0.001);
    const riding = t < 7.6;
    const sx = cx + 0.2 * Math.sin(Math.min(t, 7.6) * 1.15);
    const dir = Math.cos(t * 1.15) >= 0 ? 1 : -1;
    // the wave rolls along under them
    rig.put('wave', sx - dir * 0.05, y + 0.003, cz - 0.01, dir > 0 ? PI / 2 : -PI / 2, riding ? 0.6 : Math.max(0.001, 0.6 * (1 - ramp(t, 7.6, 8.4))));
    if (riding) {
      c.x = sx; c.z = cz; c.lift = 0.014 + Math.sin(t * 3.1) * 0.006; c.yawTarget = dir * 0.95; c.roll = -dir * 0.12 * Math.sin(t * 2.3);
      rig.put('board', sx, y + 0.008, cz, c.yaw, 1.05);
      pose(c, 'surf'); W.setFace(c, t > 3.3 ? 'happy' : 'neutral');
      if (W.rnd() < dt * 10) W.parts.emit(sx - dir * 0.04, y + 0.014, cz + 0.02, -dir * 0.04, 0.07, 0.02, 0.5, H * 0.04, 0xdff4ff, 1, 1);
    } else {
      const k = t - 7.6;
      if (k < 0.9) {
        pose(c, 'flinch', 0); c.roll = -dir * k * 3.4; c.lift = 0.014 + Math.sin(sm(k / 0.9) * PI) * 0.07;
        W.setFace(c, 'surprised');
        const b = rig.put('board', sx - dir * 0.02 * k * 4, y + 0.008 + Math.sin(k / 0.9 * PI) * 0.12, cz, c.yaw + k * 9, 1.05); b.rotation.x = k * 6;
        if (k < 0.05) rig.put('splash', sx, y + 0.01, cz, 0, 0.001);
      } else {
        c.roll *= 0.8; c.lift = Math.max(0, c.lift - dt * 0.1);
        const sp = rig.put('splash', sx, y + 0.01, cz + 0.01, 0, Math.max(0.001, 0.3 + (k - 0.9) * 1.2) * (1 - ramp(t, 8.6, 9.6)));
        sp.scale.y = 1;
        if (k > 0.9 && k < 1.0) W.parts.burst(sx, y + 0.02, cz, 10, 0.14, 0.2, 0.9, H * 0.05, DROP, 2.4, y);
        rig.bone('board').position.y = y + 0.005;
        c.roll = 0; c.tilt = 0;
        if (t < 9.4) { pose(c, 'slump'); W.setFace(c, 'sleepy'); } else { pose(c, 'tada'); W.setFace(c, 'happy'); }
      }
    }
  },
};

/** Fishes from the shore of a new ocean and hooks an old boot. */
const fish: SceneDef = {
  kind: 'fish', chars: 1, dur: 12.5, priority: 4, uses: ['bobber', 'fishLine', 'fish', 'boot', 'splash'],
  site: (W, S, req) => {
    if (!besideTile(W, S, req, 'ocean')) return false;
    const yaw = 0.62 * Math.atan2(S.dx, S.dz) + 0.38 * W.camYaw(S.x, S.z);
    S.spots[0] = {x: S.x - S.dx * 0.12, z: S.z - S.dz * 0.12 + 0.02, yaw};
    return true;
  },
  play: (W, S, t, dt) => {
    const c = S.chars[0], rig = W.rig;
    const wy = S.ty + 0.007;
    const bx = S.x + S.dx * W.grid.pitch * 0.63, bz = S.z + S.dz * W.grid.pitch * 0.63;
    const bite = ramp(t, 4.6, 4.9);
    let bobY = wy + Math.sin(t * 2.6) * 0.004 - bite * 0.016 * (1 - ramp(t, 5.0, 5.6));
    let px = bx, pz = bz;
    if (t > 5.2) { const k = ramp(t, 5.2, 6.2); px = lerp(bx, c.x + S.dx * 0.2, k); pz = lerp(bz, c.z + S.dz * 0.2, k); bobY = lerp(bobY, c.y + H * 0.2, k * k); }
    c.yawTarget = c.yaw;
    if (t < 6.4) {
      rig.put('bobber', px, bobY, pz, 0, 1);
      // the line runs from the rod's tip (read from last frame's bones) to the float
      c.ch.bones[15].localToWorld(TIP.set(0, -0.45, 0));
      const line = rig.bone('fishLine');
      const len = W.aim(line, TIP.x, TIP.y, TIP.z, px, bobY + 0.01, pz);
      line.scale.set(1, Math.max(0.001, len / H), 1);
    } else { rig.hide('bobber'); rig.hide('fishLine'); }
    if (t > 4.6 && t < 5.3 && W.rnd() < dt * 20) W.parts.emit(bx, wy + 0.004, bz, (W.rnd() - 0.5) * 0.05, 0.1, (W.rnd() - 0.5) * 0.05, 0.5, H * 0.035, 0xdff4ff, 1.5, 1, wy);
    if (t < 4.6) { pose(c, 'fish', 0); W.setFace(c, 'neutral'); }
    else if (t < 6.4) { pose(c, 'fish', ramp(t, 4.6, 5.0)); W.setFace(c, 'surprised'); }
    else if (t < 9.0) {
      pose(c, 'tada'); W.setFace(c, t < 7.6 ? 'happy' : 'sleepy');
      const u = ramp(t, 6.4, 7.4);
      off(c.yaw, 0, H * 0.1);
      const b = rig.put('boot', lerp(px, c.x + OFF.x, u), lerp(bobY, c.y + H * 1.35, u) + Math.sin(u * PI) * 0.1, lerp(pz, c.z + OFF.z, u), 0, 0.9);
      b.rotation.set(0, u * 6, 0.2 + Math.sin(u * 14) * 0.25);
    } else {
      pose(c, 'slump'); W.setFace(c, 'sleepy');
      const u = ramp(t, 9.0, 10.2);
      const b = rig.put('boot', lerp(c.x, c.x - S.dx * 0.35, u), c.y + H * 1.35 - u * H * 1.3 + Math.sin(u * PI) * 0.16, lerp(c.z, c.z - S.dz * 0.35, u), 0, 0.9 * (1 - ramp(t, 10.8, 11.6)));
      b.rotation.set(u * 9, 0, 0.5);
    }
  },
};
const TIP = new THREE.Vector3();

/** Carries bricks to a new city's edge and builds a bit of wall. */
const bricks: SceneDef = {
  kind: 'bricks', chars: 1, dur: 11.5, priority: 4, uses: ['brickPile', 'wall'],
  site: (W, S, req) => {
    if (!besideTile(W, S, req, 'city')) return false;
    S.spots[0] = {x: S.x - S.dx * 0.2 + 0.05, z: S.z - S.dz * 0.2 + 0.02, yaw: 0.4};
    return true;
  },
  play: (W, S, t, dt) => {
    const c = S.chars[0], rig = W.rig, y = S.y;
    const P = W.grid.pitch, px = S.x - S.dx * P * 0.28 - 0.02, pz = S.z - S.dz * P * 0.28;
    const wx = S.x + S.dx * P * 0.34, wz = S.z + S.dz * P * 0.34;
    const pile = t < 2.4 ? 1 : 1 - ramp(t, 2.4, 2.8) * 0.0;
    rig.put('brickPile', px, y, pz, 0.3, pile);
    const walkK = ramp(t, 2.6, 5.2);
    const yawTo = Math.atan2(wx - px, wz - pz);
    if (t < 2.4) { pose(c, 'plant'); W.setFace(c, 'neutral'); c.yawTarget = Math.atan2(px - c.x, pz - c.z) * 0.6 + 0.2; }
    else if (t < 5.4) {
      pose(c, 'carry'); c.x = lerp(px + 0.03, wx - S.dx * 0.1, walkK); c.z = lerp(pz + 0.08, wz - S.dz * 0.1 + 0.03, walkK); c.yawTarget = yawTo * 0.7 + 0.1;
      c.yaw = c.yawTarget; c.ps.ph += dt * 8 * (1 - 0.0); W.setFace(c, 'happy');
    }
    else if (t < 6.4) { pose(c, 'plant'); W.setFace(c, 'happy'); }
    else if (t < 8.0) { pose(c, 'tada'); W.setFace(c, 'happy'); }
    else { pose(c, 'celebrate'); W.setFace(c, 'happy'); }
    if (t > 5.8) rig.put('wall', wx, y, wz, Math.atan2(-S.dx, -S.dz), Math.max(0.001, back((t - 5.8) / 0.7)));
    if (crossed(S, t, 5.8)) puff(W, wx, y + 0.01, wz, 5);
    if (crossed(S, t, 8.0)) confetti(W, wx, y + 0.1, wz, 12, y);
  },
};

/** Waves a flag at the new city. */
const flag: SceneDef = {
  kind: 'flag', chars: 1, dur: 9.5, priority: 4, uses: [],
  site: (W, S, req) => {
    if (!besideTile(W, S, req, 'city')) return false;
    S.spots[0] = {x: S.x + 0.02, z: S.z + 0.06, yaw: 0.2};
    return true;
  },
  play: (W, S, t, dt) => {
    const c = S.chars[0];
    pose(c, t > 6.6 ? 'celebrate' : 'flag'); W.setFace(c, 'happy');
    for (const f of CHEERS) if (crossed(S, t, f)) confetti(W, c.x, c.y + H * 1.3, c.z, 12, c.y);
    void dt;
  },
};

/** Runs for cover behind a rock as a small meteor comes in, peeks out afterwards. */
const cover: SceneDef = {
  kind: 'cover', chars: 1, dur: 11.5, priority: 9, uses: ['rock', 'fireball', 'rockCore', 'hole'], run: true,
  site: (W, S) => {
    const act = W.chars.find((c) => c.active && !c.scene);
    const h = W.siteFor({}, act ? W.hexAt(act.x, act.z) : undefined);
    if (h === null) return false;
    W.setSite(S, h);
    S.spots[0] = {x: S.x + 0.07, z: S.z + 0.1, yaw: 0.2};
    // where the meteor lands: a free hex some way off
    const far = W.siteFor({minSteps: 3}, h);
    const t = far ?? h;
    S.target = t; S.tx = W.grid.cells[t].x; S.tz = W.grid.cells[t].z; S.ty = W.heights[t];
    if (t === h) { S.tx = S.x - 0.3; S.tz = S.z - 0.2; }
    return true;
  },
  play: (W, S, t, dt) => {
    const c = S.chars[0], rig = W.rig, y = S.y;
    rig.put('rock', S.x + 0.04, y, S.z + 0.0, 0.5, 1.15);
    const T = 1.6, k = (t - 0.5) / T;
    if (k >= 0 && k < 1) {
      const e = k * k * (0.4 + 0.6 * k);
      const sx = S.tx - 1.3, sy = S.ty + 2.0, sz = S.tz - 1.6;
      const px = lerp(sx, S.tx, e), py = lerp(sy, S.ty + 0.03, e), pz = lerp(sz, S.tz, e);
      const fb = rig.put('fireball', px, py, pz, 0, 1.0);
      fb.lookAt(px - (S.tx - sx), py - (S.ty - sy), pz - (S.tz - sz));
      fb.scale.setScalar(1.0);
      W.parts.emit(px, py, pz, 0, 0.02, 0, 0.5, H * 0.1, SMOKE, 0, 1);
    } else if (k >= 1) {
      const u = (t - 0.5 - T);
      const fb = rig.bone('fireball'); fb.position.set(S.tx, S.ty + 0.03, S.tz); fb.scale.setScalar(Math.max(0.001, 0.9 * (1 - ramp(u, 0, 0.5)))); fb.rotation.set(0, 0, 0);
      if (u < 0.05) {
        W.parts.burst(S.tx, S.ty + 0.03, S.tz, 14, 0.2, 0.22, 0.9, H * 0.08, SPARK, 2, S.ty); W.parts.burst(S.tx, S.ty + 0.02, S.tz, 10, 0.12, 0.08, 1.6, H * 0.14, SMOKE, -0.1, -0.4);
        rig.put('hole', S.tx, S.ty, S.tz, 0, 0.9); rig.put('rockCore', S.tx, S.ty + 0.01, S.tz, 0, 0.8);
      }
      if (u > 0.2 && u < 4.5 && W.rnd() < dt * 4) W.parts.emit(S.tx, S.ty + 0.04, S.tz, 0, 0.05, 0, 1.4, H * 0.08, SMOKE, 0, -0.5);
    } else { rig.hide('fireball'); }
    const impact = t - (0.5 + T);
    if (impact < 0) { pose(c, 'flinch', ramp(t, 0.3, 0.6)); }
    else if (impact < 3.3) { pose(c, 'flinch', ramp(impact, 0, 2)); W.setFace(c, 'surprised'); }
    else if (impact < 5.3) { pose(c, 'peek', 0); W.setFace(c, 'surprised'); }
    else if (impact < 6.4) { pose(c, 'lookup', ramp(impact, 5.3, 5.8)); W.setFace(c, 'neutral'); }
    else { pose(c, 'celebrate'); W.setFace(c, 'happy'); }
    c.yawTarget = c.yaw;
  },
};

/** Rolls a giant gold coin across the hex. */
const coin: SceneDef = {
  kind: 'coin', chars: 1, dur: 12, priority: 6, uses: ['coin'],
  site: (W, S) => basicSite(W, S, (s) => { s.spots[0] = {x: s.x - 0.22, z: s.z + 0.1, yaw: 1.3}; }),
  play: (W, S, t, dt) => {
    const c = S.chars[0], rig = W.rig, y = S.y;
    const a = 0.5 * H;                    // the coin's radius on the board
    const roll = sm(Math.min(1, t / 7)) * 0.5 + Math.min(1, t / 7) * 0.5;
    const cx = S.x - 0.13 + 0.42 * roll, cz = S.z + 0.1 - 0.03 * roll;
    // it rolls toward +x, leans and wobbles as it slows, then tips flat and spins down
    const fall = ramp(t, 7.4, 9.0);
    const lean = (1 - fall) * (t > 6.0 ? Math.sin(t * 15) * 0.2 * ramp(t, 6.0, 7.4) : 0) + fall * PI / 2;
    const spin = t < 7 ? roll * 7.2 : 7.2 + (1 - Math.exp(-(t - 7) * 1.2)) * 3;
    const b = rig.put('coin', cx, y + a * Math.cos(lean) + 0.03 * H * Math.sin(lean), cz, 0, 2.3);
    b.rotation.order = 'YXZ'; b.rotation.set(-spin, PI / 2, lean);
    if (t < 7) {
      c.x = cx - 0.1; c.z = cz + 0.0; c.yawTarget = 1.3; c.yaw = 1.3; c.ps.ph += dt * 6; pose(c, 'roll'); W.setFace(c, 'happy');
      if (W.rnd() < dt * 12) puff(W, cx - 0.06, y + 0.01, cz, 1, H * 0.045);
    } else if (t < 9.6) { pose(c, 'startle', 0.5 + 0.5 * Math.sin(t * 6)); W.setFace(c, 'surprised'); c.yawTarget = 0.6; }
    else { pose(c, 'celebrate'); W.setFace(c, 'happy'); c.yawTarget = 0.1; }
    if (crossed(S, t, 9.0)) sparkle(W, cx, y + 0.05, cz, 12, 0xffd54a);
  },
};

/** Puts on sunglasses. */
const shades: SceneDef = {
  kind: 'shades', chars: 1, dur: 7.5, priority: 5, uses: [],
  site: (W, S) => basicSite(W, S, (s) => { s.spots[0] = {x: s.x, z: s.z + 0.1, yaw: 0.05}; }),
  play: (W, S, t) => {
    const c = S.chars[0];
    pose(c, 'shades', ramp(t, 0.5, 3.6)); W.setFace(c, t > 3.6 ? 'happy' : 'neutral');
    if (crossed(S, t, 2.3)) sparkle(W, c.x, c.y + H * 0.82, c.z + H * 0.2, 6, 0xffffff);
    if (t > 5.2) pose(c, 'wave');
  },
};

/** A little crate conveyor for the production phase. */
const conveyor: SceneDef = {
  kind: 'conveyor', chars: 1, dur: 12.5, priority: 3, uses: ['conveyor', 'cvA', 'cvB', 'cvC', 'cvD'],
  site: (W, S) => basicSite(W, S, (s) => { s.spots[0] = {x: s.x + 0.2, z: s.z + 0.1, yaw: -0.5}; }),
  play: (W, S, t, dt) => {
    const c = S.chars[0], rig = W.rig, y = S.y;
    const sc = 1.5, bx = S.x - 0.02, bz = S.z - 0.02, top = y + 0.135 * H * sc;
    rig.put('conveyor', bx, y, bz, 0, Math.max(0.001, sc * ramp(t, 0, 0.5)));
    const L = 1.1 * H * sc, end = bx + L / 2;
    rig.hide('cvD');
    for (let i = 0; i < 3; i++) {
      const born = 0.6 + i * 2.4, u = Math.max(0, (t - born) * 0.17);
      const px = bx - L / 2 + u * L * 1.35, over = Math.max(0, px - end) / (0.06 * H * sc);
      const live = t > born && t < 10.2 && over < 3;
      const b = rig.put(CV[i], px, Math.max(y, top - over * over * 0.02 * sc), bz, 0, live ? sc : 0.001);
      b.rotation.z = -Math.min(1.4, over * 0.5);
    }
    if (t < 9.4) { pose(c, 'catch', ramp(t, 1, 2)); W.setFace(c, 'happy'); c.x = end + 0.07; c.z = bz + 0.03; c.yawTarget = -0.8; }
    else if (t < 10.6) { pose(c, 'tada'); W.setFace(c, 'happy'); }
    else { pose(c, 'celebrate'); W.setFace(c, 'happy'); }
    if (crossed(S, t, 9.5)) confetti(W, end + 0.05, top, bz, 10, y);
    void dt;
  },
};

/** Two characters play catch with a chunk of ice; the last throw bonks. */
const catchIce: SceneDef = {
  kind: 'catch', chars: 2, dur: 13.5, priority: 2, uses: ['ice'],
  site: (W, S) => basicSite(W, S, (s) => { s.spots[0] = {x: s.x - 0.17, z: s.z + 0.08, yaw: 1.15}; s.spots[1] = {x: s.x + 0.17, z: s.z + 0.08, yaw: -1.15}; }),
  play: (W, S, t, dt) => {
    const [a, b] = S.chars, rig = W.rig, y = S.y;
    const period = 1.5, n = Math.floor(t / period), ph = (t % period) / period;
    const thrower = n % 2 === 0 ? a : b, catcher = n % 2 === 0 ? b : a;
    const last = t > 8.6;
    const ax = thrower.x, bx = catcher.x, hy = y + H * 0.85;
    let ix: number, iy: number, iz = S.z + 0.08;
    if (last) {
      const u = t - 8.6;
      // the ice hits a head, bounces high, lands and slides
      ix = lerp(a.x, b.x, ramp(u, 0, 0.55)) + (u > 0.55 ? Math.min(0.1, (u - 0.55) * 0.12) : 0);
      iy = u < 0.55 ? hy + Math.sin(ramp(u, 0, 0.55) * PI) * 0.1 : Math.max(y + H * 0.1, hy + H * 0.2 + Math.sin((u - 0.55) * 4) * 0.12 - (u - 0.55) * 0.2);
      if (u > 1.6) iy = y + H * 0.1;
    } else { const k = ph; ix = lerp(ax, bx, k); iy = hy + Math.sin(k * PI) * 0.13; }
    rig.put('ice', ix, iy, iz, t * 3, 1.0);
    if (!last) {
      pose(thrower, 'throw', ph < 0.5 ? ph * 2 : 1); pose(catcher, 'catch', 1);
      W.setFace(thrower, 'happy'); W.setFace(catcher, 'happy');
    } else {
      const u = t - 8.6;
      pose(a, u < 0.55 ? 'throw' : u < 1.8 ? 'startle' : 'celebrate', u < 0.55 ? ramp(u, 0, 0.3) : ramp(u, 0.55, 1.1)); pose(b, u < 0.55 ? 'catch' : u < 1.8 ? 'startle' : 'celebrate', ramp(u, 0.55, 1.1));
      W.setFace(a, u < 0.55 ? 'happy' : 'surprised'); W.setFace(b, u < 0.55 ? 'happy' : 'surprised');
      if (u > 0.5 && u < 0.58) sparkle(W, b.x, y + H * 1.1, b.z, 8, 0xcfeeff);
      if (u > 3.0) { pose(a, 'wave'); pose(b, 'wave'); W.setFace(a, 'happy'); W.setFace(b, 'happy'); }
    }
    void dt;
  },
};

/** Waves at the camera. */
const camwave: SceneDef = {
  kind: 'camwave', chars: 2, dur: 8.5, priority: 2, uses: [],
  site: (W, S) => {
    // the free hex nearest the camera, beyond the top rows
    let best = -1, bz = -Infinity;
    const used = W.usedHexes();
    W.grid.cells.forEach((c, i) => { if (W.free[i] && !used.has(i) && !c.space.bonus.length && c.z > bz) { bz = c.z; best = i; } });
    if (best < 0) return false;
    W.setSite(S, best);
    S.spots[0] = {x: S.x - 0.15, z: S.z + 0.05, yaw: 0.2}; S.spots[1] = {x: S.x + 0.15, z: S.z + 0.05, yaw: -0.2};
    return true;
  },
  play: (W, S, t) => {
    for (const c of S.chars) { pose(c, 'camwave'); W.setFace(c, 'happy'); c.yawTarget = W.camYaw(c.x, c.z); }
    if (t > 7.0) for (const c of S.chars) pose(c, 'celebrate');
  },
};

// ================================================================================================================
// things from the sky
// ================================================================================================================

/** A free hex for something that falls; the object lands near its middle. */
function skySite(W: LifeWorld, S: Scene, want = {}): boolean {
  const h = W.siteFor(want);
  if (h === null) return false;
  W.setSite(S, h);
  S.tx = S.x + (W.rnd() - 0.5) * 0.2; S.tz = S.z + (W.rnd() - 0.5) * 0.14 + 0.04; S.ty = S.y;
  return true;
}

/** A supply crate on a parachute: it lands, the lid pops, and confetti comes out. */
const crate: SceneDef = {
  kind: 'crate', chars: 0, dur: 14, priority: 1, uses: ['chute', 'crate', 'crateLid'],
  site: (W, S) => skySite(W, S),
  play: (W, S, t, dt) => {
    const rig = W.rig, T = 6.8, y = S.ty;
    const k = Math.min(1, t / T), h = 2.0 * Math.pow(1 - k, 1.25);
    const sway = Math.sin(t * 1.4) * 0.07 * (1 - k * 0.8);
    const px = S.tx + sway, pz = S.tz;
    const land = t >= T;
    rig.put('crate', px, y + h, pz, sway * 1.5, 2.0);
    rig.bone('crate').rotation.z = sway * 0.8;
    if (!land) {
      const cb = rig.put('chute', px, y + h + 0.4 * H, pz, 0, 2.0); cb.rotation.z = sway * 0.8;
    } else {
      const u = (t - T) / 2.4;
      const cb = rig.put('chute', px + u * 0.12, y + 0.4 * H * (1 - u * 0.6), pz + u * 0.02, 0, Math.max(0.001, 2.0 * (1 - ramp(u, 0.4, 1))));
      cb.rotation.z = u * 1.1; cb.scale.y = Math.max(0.001, 2.0 * (1 - u * 0.8) * (1 - ramp(u, 0.4, 1)));
    }
    if (crossed(S, t, T)) puff(W, px, y + 0.01, pz, 6);
    const lid = rig.bone('crateLid');
    lid.rotation.x = land ? -1.9 * back((t - T - 0.8) / 0.5) : 0;
    if (crossed(S, t, T + 0.85)) confetti(W, px, y + H * 0.35, pz, 18, y);
    if (crossed(S, t, T + 1.8)) sparkle(W, px, y + H * 0.7, pz, 8, 0xffffff);
    if (t > 12.0) { rig.bone('crate').scale.setScalar(Math.max(0.001, 2.0 * (1 - ramp(t, 12.0, 13.6)))); }
    W.blobs.add(px, y + 0.004, pz, H * (0.45 + 0.2 * (1 - k)) * (t > 12 ? 1 - ramp(t, 12, 13.6) : 1));
    if (t < T + 3) W.rings.add(S.tx, y + 0.005, S.tz, H * 0.7);
    void dt;
  },
};

/** A cow on a parachute: a nod to the Livestock card. It moos, shakes off the chute, and trots off. */
const cow: SceneDef = {
  kind: 'cow', chars: 0, dur: 17, priority: 1, uses: ['chute', 'cow', 'cowHead'],
  site: (W, S) => skySite(W, S),
  play: (W, S, t, dt) => {
    const rig = W.rig, T = 7.0, y = S.ty;
    const k = Math.min(1, t / T), h = 2.1 * Math.pow(1 - k, 1.25);
    const sway = Math.sin(t * 1.3) * 0.07 * (1 - k * 0.8);
    let px = S.tx + sway, pz = S.tz, hop = 0;
    const walk = ramp(t, 10.0, 13.2);
    if (t >= T + 1.2) { px = S.tx + 0.1 * walk * Math.sign(S.tx - S.x + 0.01) * -1 + 0.0; pz = S.tz - 0.08 * walk; hop = walk * (1 - ramp(t, 13.2, 13.4)) * Math.abs(Math.sin(t * 9)) * 0.012; }
    const land = t >= T;
    const squash = land ? Math.exp(-(t - T) * 5) * Math.sin((t - T) * 22) * 0.12 : 0;
    const cb = rig.put('cow', px, y + h + hop, pz, land ? (walk > 0 ? -0.9 * walk : 0.5 * Math.sin(t * 0.8) * ramp(t, T + 1, T + 2)) : sway * 1.2, 1.0);
    cb.scale.set(2.2 * (1 + squash), 2.2 * (1 - squash), 2.2 * (1 + squash));
    const hd = rig.bone('cowHead');
    hd.rotation.set(land ? 0.25 * Math.sin(t * 5) * ramp(t, T + 2.5, T + 3) * (t < 10 ? 1 : 0.4) : 0.1, land ? 0.45 * Math.sin(t * 1.7) : 0, 0);
    if (!land) { const ch = rig.put('chute', px, y + h + 1.1 * H, pz, 0, 2.2); ch.rotation.z = sway * 0.8; }
    else {
      const u = (t - T) / 2.6;
      const ch = rig.put('chute', px + u * 0.14, y + 1.1 * H * (1 - u * 0.8), pz + u * 0.03, 0, Math.max(0.001, 2.2 * (1 - ramp(u, 0.45, 1))));
      ch.rotation.z = u * 1.2; ch.scale.y = Math.max(0.001, 2.2 * (1 - u * 0.8) * (1 - ramp(u, 0.45, 1)));
      if (t < T + 0.1) puff(W, px, y + 0.01, pz, 6);
    }
    // a moo: notes drift up
    if (crossed(S, t, T + 1.6) || crossed(S, t, T + 4.4)) { W.parts.emit(px, y + 0.5 * H, pz + 0.08, 0.02, 0.1, 0.05, 1.3, H * 0.06, 0xffe27a, -0.05, 0.4); W.parts.emit(px + 0.02, y + 0.55 * H, pz + 0.08, -0.02, 0.12, 0.06, 1.5, H * 0.05, 0xffffff, -0.05, 0.4); }
    if (crossed(S, t, 14.2)) puff(W, px, y + 0.03, pz, 8, H * 0.1);
    if (t > 14.2) rig.hide('cow');
    W.blobs.add(px, y + 0.004, pz, H * (t > 14.2 ? 0 : 0.6));
    if (t < T + 3) W.rings.add(S.tx, y + 0.005, S.tz, H * 0.8);
    void dt;
  },
};

/** A rubber duck falls into an ocean and bobs there. */
const duck: SceneDef = {
  kind: 'duck', chars: 0, dur: 12, priority: 1, uses: ['duck', 'splash'],
  site: (W, S) => {
    const oc: number[] = [];
    W.grid.cells.forEach((c, i) => { if (W.isOcean(c.space) && !W.busy.has(c.id)) oc.push(i); });
    if (!oc.length) return false;
    const h = oc[Math.floor(W.rnd() * oc.length)];
    S.hexes = []; S.x = W.grid.cells[h].x; S.z = W.grid.cells[h].z; S.y = W.heights[h]; S.target = h;
    S.tx = S.x; S.tz = S.z; S.ty = S.y + 0.012;
    return true;
  },
  play: (W, S, t, dt) => {
    const rig = W.rig, T = 1.5, y = S.ty;
    if (t < T) {
      const k = t / T, h = 2.0 * (1 - k * k);
      const b = rig.put('duck', S.tx - 0.03, y + h, S.tz + 0.02, 0, 2.2);
      b.rotation.set(k * 9, k * 5, k * 3);
    } else {
      const u = t - T, bob = Math.sin(u * 2.4) * 0.006, fadeOut = ramp(t, 10.4, 11.8);
      const ang = u * 0.5, rr = 0.05 * ramp(u, 0, 1);
      const b = rig.put('duck', S.tx - 0.03 + Math.cos(ang) * rr, y + 0.004 + bob + (u < 0.4 ? Math.sin(u / 0.4 * PI) * 0.05 : 0), S.tz + 0.02 + Math.sin(ang) * rr * 0.8, -ang + PI / 2, 2.2 * (1 - fadeOut));
      b.rotation.z = Math.sin(u * 2.4 + 1) * 0.12; b.rotation.x = Math.sin(u * 1.9) * 0.08;
      const sp = rig.put('splash', S.tx - 0.03, y + 0.004, S.tz + 0.02, 0, Math.max(0.001, (0.3 + u * 0.9) * (1 - ramp(u, 0.2, 1.8))));
      sp.scale.y = 1;
      if (crossed(S, t, T)) W.parts.burst(S.tx - 0.03, y + 0.02, S.tz + 0.02, 12, 0.14, 0.24, 1.0, H * 0.05, DROP, 2.4, y);
      if (crossed(S, t, 7.0)) sparkle(W, S.tx, y + 0.05, S.tz, 5, 0xffffff);
      W.blobs.add(S.tx - 0.03, y + 0.003, S.tz + 0.02, H * 0.35 * (1 - fadeOut));
    }
    void dt;
  },
};

/** A "meteor" that turns out to be a pizza; someone nearby is very happy. */
const pizza: SceneDef = {
  kind: 'pizza', chars: 0, dur: 15, priority: 1, uses: ['fireball', 'pizza', 'slice'],
  site: (W, S) => skySite(W, S),
  play: (W, S, t, dt) => {
    const rig = W.rig, T = 2.3, y = S.ty;
    const sx = S.tx - 1.5, sy = y + 2.2, sz = S.tz - 1.7;
    if (t < T) {
      const k = t / T, e = Math.pow(k, 1.7);
      const px = lerp(sx, S.tx, e), py = lerp(sy, y + 0.03, e), pz = lerp(sz, S.tz, e);
      const fb = rig.put('fireball', px, py, pz, 0, 1.5);
      fb.lookAt(px - (S.tx - sx), py - (y - sy), pz - (S.tz - sz));
      W.parts.emit(px, py, pz, (W.rnd() - 0.5) * 0.05, 0.03, 0, 0.6, H * 0.1, k > 0.6 ? 0xffb347 : SMOKE, 0, 1);
      rig.put('pizza', S.tx, y - 0.2, S.tz, 0, 0.001);
      W.rings.add(S.tx, y + 0.005, S.tz, H * 0.7 * ramp(t, 0.3, 1.4));
    } else {
      const u = t - T;
      const fb = rig.bone('fireball'); fb.position.set(S.tx, y + 0.03, S.tz); fb.rotation.set(0, 0, 0);
      fb.scale.setScalar(Math.max(0.001, 1.0 * (1 - ramp(u, 0, 0.7))));
      if (u < 0.05) { W.parts.burst(S.tx, y + 0.03, S.tz, 14, 0.2, 0.22, 0.9, H * 0.08, SPARK, 2, y); W.parts.burst(S.tx, y + 0.02, S.tz, 8, 0.1, 0.06, 1.2, H * 0.1, DUST, -0.1, -0.3); }
      const pb = rig.put('pizza', S.tx, y + (u < 0.6 ? Math.sin(u / 0.6 * PI) * 0.06 : 0), S.tz, u * (u < 1 ? 6 : 0) * (1 - ramp(u, 0, 1.2)) , 1.0);
      pb.scale.setScalar(2.0 * ramp(u, 0.1, 0.5) + 0.001);
      // steam
      if (u > 0.8 && u < 9 && W.rnd() < dt * 7) W.parts.emit(S.tx + (W.rnd() - 0.5) * 0.08, y + 0.06, S.tz + (W.rnd() - 0.5) * 0.08, 0, 0.06, 0, 1.4, H * 0.06, 0xffffff, -0.04, -0.4);
      // a hungry arrival
      if (u > 1.3 && S.n0 === 0) {
        S.n0 = 1;
        const c = W.chars.find((x) => !x.scene);
        if (c) {
          c.scene = S; S.chars = [c]; S.spots[0] = {x: S.tx - 0.14, z: S.tz + 0.09, yaw: 0.9};
          W.sendTo(c, S.spots[0]);
          S.n1 = 1;
        }
      }
      const c = S.chars[0];
      if (c && S.n1 === 1 && c.active && !c.walking && !c.pending && c.vis > 0.95) {
        if (S.n2 === 0) S.n2 = t;
        const e = t - S.n2;
        c.yawTarget = 0.9;
        if (e < 3.6) { pose(c, 'eat'); W.setFace(c, 'happy'); const sb = rig.put('slice', lerp(S.tx, c.x + 0.03, ramp(e, 0.2, 0.8)), y + lerp(0.02, H * 0.75, ramp(e, 0.2, 0.9)), lerp(S.tz, c.z + 0.04, ramp(e, 0.2, 0.8)), 0.5, 1.0 * (1 - ramp(e, 2.2, 3.0))); sb.rotation.x = -0.4; }
        else { pose(c, 'celebrate'); W.setFace(c, 'happy'); rig.hide('slice'); }
      } else rig.hide('slice');
      if (t > 13.2) pb.scale.setScalar(Math.max(0.001, 2.0 * (1 - ramp(t, 13.2, 14.6))));
      W.blobs.add(S.tx, y + 0.004, S.tz, H * 0.5 * ramp(u, 0.2, 0.6));
      if (u < 6) W.rings.add(S.tx, y + 0.005, S.tz, H * 0.7);
    }
    void dt;
  },
  end: (W, S) => { for (const c of S.chars) { c.scene = null; } },
};

/** Space junk bounces off a city's dome. */
const junk: SceneDef = {
  kind: 'junk', chars: 0, dur: 10, priority: 1, uses: ['junk'],
  site: (W, S) => {
    const cities: number[] = [];
    W.grid.cells.forEach((c, i) => { if (W.isCity(c.space) && !W.busy.has(c.id)) cities.push(i); });
    if (!cities.length) return false;
    const h = cities[Math.floor(W.rnd() * cities.length)];
    S.hexes = []; S.x = W.grid.cells[h].x; S.z = W.grid.cells[h].z; S.y = W.heights[h]; S.target = h;
    const a = W.rnd() * PI * 2;
    S.dx = Math.sin(a); S.dz = Math.cos(a);
    return true;
  },
  play: (W, S, t, dt) => {
    const rig = W.rig, domeY = S.y + 0.48 * 0.475 * 1.6 / 1.85;
    const T = 1.9;
    if (t < T) {
      const k = t / T, e = k * k;
      const b = rig.put('junk', lerp(S.x - 0.9, S.x + S.dx * 0.05, e), lerp(domeY + 2.2, domeY, e), lerp(S.z - 1.0, S.z + S.dz * 0.05, e), 0, 1.0);
      b.rotation.set(k * 6, k * 8, k * 3);
      if (W.rnd() < dt * 16) W.parts.emit(b.position.x, b.position.y, b.position.z, 0, 0.03, 0, 0.4, H * 0.07, 0xffb347, 0, 1);
    } else {
      const u = t - T;
      // up and away off the dome, then down to the ground beyond the city, once more small
      const vx = S.dx * 0.34, vz = S.dz * 0.34, g = 1.6, vy = 0.7;
      const x = S.x + S.dx * 0.05 + vx * u, z = S.z + S.dz * 0.05 + vz * u;
      let y = domeY + vy * u - 0.5 * g * u * u;
      const gy = W.groundAt(x, z);
      let bounced = 0;
      if (y < gy + 0.03) { const u2 = Math.max(0, u - 0.95); y = gy + 0.03 + Math.abs(Math.sin(u2 * 5.5)) * 0.05 * Math.exp(-u2 * 1.6); bounced = 1; }
      const b = rig.put('junk', x, y, z, 0, 1.0 * (1 - ramp(t, 8.4, 9.6)));
      b.rotation.set(u * 5 * (bounced ? Math.exp(-(u - 0.95)) : 1), u * 6, u * 2 * (bounced ? Math.exp(-(u - 0.95)) : 1));
      if (u < 0.06) { W.parts.burst(S.x + S.dx * 0.05, domeY, S.z + S.dz * 0.05, 8, 0.14, 0.1, 0.6, H * 0.05, 0xfff0b0, 1, 1); }
      if (bounced && u > 0.93 && u < 1.0) W.parts.burst(x, gy + 0.02, z, 6, 0.1, 0.08, 0.6, H * 0.05, DUST, 1, gy);
      W.blobs.add(x, gy + 0.004, z, H * 0.22 * (1 - ramp(t, 8.4, 9.6)));
    }
  },
};

// ================================================================================================================
export const AMBIENT_SCENES: Record<AmbientKind, SceneDef> = {plant, drill, rover, mop, selfie, nap};
export const REACTION_SCENES: Partial<Record<ReactionKind, SceneDef>> = {surf, fish, bricks, flag, cover, coin, shades, conveyor, catch: catchIce, camwave};
export const FALL_SCENES: Record<FallKind, SceneDef> = {crate, cow, duck, pizza, junk};
