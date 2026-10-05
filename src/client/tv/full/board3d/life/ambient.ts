// Ambient life with no characters in it: a tiny rover with a dish that wanders the empty hexes, dust devils that drift
// across them, a delivery drone that flies between two cities, and lichen specks that spread over empty ground as the
// oxygen rises. Dust devils and lichen are instanced (one draw call each); the rover and the drone are parts of the props mesh.
import * as THREE from 'three';
import {path} from './hexgrid';
import {CHAR_H, LIFE_SCALE} from './props';
import type {FrameCtx, LifeWorld} from './world';

const H = CHAR_H;
const MAX_LICHEN = 150;
const hash = (a: number, b: number) => { let h = Math.imul(a ^ 0x9e3779b1, 0x85ebca6b) ^ Math.imul(b + 0x1234567, 0xc2b2ae35); h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d); return ((h ^ (h >>> 13)) >>> 0) / 4294967296; };

type Rover = {state: 'gone' | 'in' | 'drive' | 'scan' | 'out'; at: number; x: number; z: number; yaw: number; pts: number[]; pi: number; scan: number; trips: number; wait: number; s: number; wheel: number};
type Devil = {live: boolean; x: number; z: number; tx: number; tz: number; hex: number; age: number; life: number; wait: number; spin: number; emit: number};
type Drone = {state: 'gone' | 'out' | 'drop' | 'back' | 'away'; a: number; b: number; t: number; wait: number; s: number; x: number; z: number; y: number};

export class Ambient {
  readonly meshes: THREE.Object3D[];
  private lichen: THREE.InstancedMesh;
  private cand: Array<{hex: number; x: number; z: number; rank: number; size: number; color: number}> = [];
  private grow = new Float32Array(MAX_LICHEN);
  private shown: number[] = [];
  private lastOx = -1; private growing = false;
  private rover: Rover = {state: 'gone', at: 0, x: 0, z: 0, yaw: 0, pts: [], pi: 0, scan: 0, trips: 0, wait: 12, s: 0, wheel: 0};
  private devils: Devil[] = [0, 1].map(() => ({live: false, x: 0, z: 0, tx: 0, tz: 0, hex: -1, age: 0, life: 30, wait: 6 + Math.random() * 10, spin: 0, emit: 0}));
  private drone: Drone = {state: 'gone', a: -1, b: -1, t: 0, wait: 25, s: 0, x: 0, z: 0, y: 0};
  private dummy = new THREE.Object3D();
  private col = new THREE.Color();
  private visible = false;

  constructor(private W: LifeWorld) {
    const lg = new THREE.IcosahedronGeometry(1, 0); lg.scale(1, 0.35, 1);
    this.lichen = new THREE.InstancedMesh(lg, new THREE.MeshLambertMaterial({color: '#ffffff'}), MAX_LICHEN);
    this.lichen.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_LICHEN * 3).fill(1), 3);
    this.lichen.frustumCulled = false; (this.lichen.instanceMatrix.array as Float32Array).fill(0); this.lichen.count = 1;
    this.meshes = [this.lichen];
  }

  // ---- lifecycle ---------------------------------------------------------------------------------------------------
  show() { this.visible = true; this.lastOx = -1; this.rebuildLichen(); }
  hide() {
    this.visible = false;
    this.lichen.count = 1; (this.lichen.instanceMatrix.array as Float32Array).fill(0, 0, 16);
    for (const n of ['ambRover', 'drone']) this.W.rig.hide(n);
    this.rover.state = 'gone'; this.rover.wait = 8; this.drone.state = 'gone'; this.drone.wait = 15;
    for (const d of this.devils) { d.live = false; d.wait = 4 + Math.random() * 8; }
    this.W.inUse.delete('ambRover'); this.W.inUse.delete('drone');
  }
  dispose() { for (const m of this.meshes) { (m as THREE.InstancedMesh).geometry.dispose(); ((m as THREE.InstancedMesh).material as THREE.Material).dispose(); } }

  /** The board changed: lichen only grows on empty land, and the rover and dust devils keep to it. */
  board() {
    const W = this.W;
    // candidate specks per land hex, placed in the outer ring where the hex's icons are not
    this.cand = [];
    W.grid.cells.forEach((c, i) => {
      if (c.space.spaceType !== 'land') return;
      for (let k = 0; k < 4; k++) {
        const hs = hash(i * 31 + k, 17), a = hash(i, k + 5) * Math.PI * 2, rr = (0.5 + hash(k, i + 9) * 0.34) * this.W.grid.pitch * 0.58;
        this.cand.push({hex: i, x: c.x + Math.sin(a) * rr, z: c.z + Math.cos(a) * rr * 0.9, rank: hs, size: 0.016 + hash(i, k + 2) * 0.016,
          color: [0xc9742f, 0x8fae3a, 0xb8c24a, 0xd88a3a][Math.floor(hash(k, i) * 4)]});
      }
    });
    this.cand.sort((a, b) => a.rank - b.rank);
    this.lastOx = -1;
    if (this.visible) this.rebuildLichen();
    const r = this.rover;
    if (r.state !== 'gone' && r.state !== 'out') { const h = W.hexAt(r.x, r.z); if (h < 0 || !W.free[h] || r.pts.some((_, j) => j % 2 === 0 && !this.freeAt(r.pts[j], r.pts[j + 1]))) { r.state = 'out'; } }
    for (const d of this.devils) if (d.live && d.hex >= 0 && !W.free[d.hex]) d.age = Math.max(d.age, d.life - 1.5);
  }
  private freeAt(x: number, z: number) { const h = this.W.hexAt(x, z); return h >= 0 && this.W.free[h]; }

  // ---- lichen ------------------------------------------------------------------------------------------------------
  private rebuildLichen() {
    const W = this.W;
    const want = Math.round(Math.min(1, Math.max(0, W.oxygen / 14)) * MAX_LICHEN);
    this.shown = [];
    for (let i = 0; i < this.cand.length && this.shown.length < want; i++) { if (W.free[this.cand[i].hex]) this.shown.push(i); }
    const arr = this.lichen.instanceColor!.array as Float32Array;
    for (let j = 0; j < this.shown.length; j++) { const cd = this.cand[this.shown[j]]; this.col.setHex(cd.color); arr[j * 3] = this.col.r; arr[j * 3 + 1] = this.col.g; arr[j * 3 + 2] = this.col.b; if (this.grow[j] === 0) this.grow[j] = 0.001; }
    this.lichen.count = Math.max(1, this.shown.length);
    if (!this.shown.length) (this.lichen.instanceMatrix.array as Float32Array).fill(0, 0, 16);
    this.lichen.instanceColor!.needsUpdate = true;
    this.growing = true;
    this.writeLichen(0);
  }
  private writeLichen(dt: number) {
    const W = this.W, a = this.lichen.instanceMatrix.array as Float32Array;
    let any = false;
    for (let j = 0; j < this.shown.length; j++) {
      const cd = this.cand[this.shown[j]];
      this.grow[j] = dt === 0 && W.reduced ? 1 : Math.min(1, this.grow[j] + dt * 0.8);
      if (this.grow[j] < 1) any = true;
      const s = cd.size * (1 - Math.pow(1 - this.grow[j], 3)) * (this.grow[j] < 1 ? 1 + 0.4 * Math.sin(this.grow[j] * Math.PI) : 1);
      const o = j * 16, y = W.heights[cd.hex] + 0.002;
      a[o] = s; a[o + 1] = 0; a[o + 2] = 0; a[o + 3] = 0; a[o + 4] = 0; a[o + 5] = s; a[o + 6] = 0; a[o + 7] = 0; a[o + 8] = 0; a[o + 9] = 0; a[o + 10] = s; a[o + 11] = 0;
      a[o + 12] = cd.x; a[o + 13] = y; a[o + 14] = cd.z; a[o + 15] = 1;
    }
    this.lichen.instanceMatrix.needsUpdate = true;
    this.growing = any;
  }

  // ---- per frame -----------------------------------------------------------------------------------------------------
  tick(dt: number, f: FrameCtx) {
    const W = this.W;
    const ox = Math.round(W.oxygen * 2) / 2;
    if (ox !== this.lastOx) { this.lastOx = ox; this.rebuildLichen(); }
    else if (this.growing) this.writeLichen(dt);
    this.tickRover(dt);
    this.tickDevils(dt);
    this.tickDrone(dt);
    void f;
  }

  /** Reduced motion: the lichen and a parked rover, nothing moves. */
  still() {
    const W = this.W;
    this.rebuildLichen();
    for (let j = 0; j < this.grow.length; j++) this.grow[j] = 1;
    this.writeLichen(0);
    const h = W.siteFor({bonusFree: true});
    if (h !== null && !W.inUse.has('ambRover')) {
      const c = W.grid.cells[h];
      W.inUse.add('ambRover');
      W.rig.put('ambRover', c.x + 0.1, W.heights[h], c.z - 0.12, -0.6, 1);
      W.blobs.add(c.x + 0.1, W.heights[h] + 0.004, c.z - 0.12, H * 0.4);
    }
  }

  // ---- the rover -----------------------------------------------------------------------------------------------------
  private tickRover(dt: number) {
    const W = this.W, r = this.rover, rig = W.rig;
    if (r.state === 'gone') {
      r.wait -= dt;
      if (r.wait > 0 || W.inUse.has('ambRover')) return;
      const h = W.siteFor({bonusFree: true});
      if (h === null) { r.wait = 10; return; }
      const c = W.grid.cells[h];
      r.x = c.x; r.z = c.z; r.state = 'in'; r.s = 0; r.trips = 0; r.pts = []; r.yaw = 0; W.inUse.add('ambRover');
      this.planRover();
    }
    if (r.state === 'in') { r.s = Math.min(1, r.s + dt * 2.5); if (r.s >= 1) r.state = r.pts.length ? 'drive' : 'scan'; }
    if (r.state === 'out') { r.s = Math.max(0, r.s - dt * 2.5); if (r.s <= 0) { r.state = 'gone'; r.wait = 25 + Math.random() * 25; rig.hide('ambRover'); W.inUse.delete('ambRover'); return; } }
    let speed = 0;
    if (r.state === 'drive') {
      const tx = r.pts[r.pi * 2], tz = r.pts[r.pi * 2 + 1];
      const dx = tx - r.x, dz = tz - r.z, d = Math.hypot(dx, dz), step = 0.13 * dt;
      const nh = W.hexAt(tx, tz);
      if (nh >= 0 && W.usedHexes().has(nh)) { r.state = 'out'; }
      if (d <= step) { r.x = tx; r.z = tz; r.pi++; if (r.pi * 2 >= r.pts.length) { r.state = 'scan'; r.scan = 0; } }
      else { r.x += (dx / d) * step; r.z += (dz / d) * step; const want = Math.atan2(-dz, dx); let da = (want - r.yaw) % (Math.PI * 2); if (da > Math.PI) da -= Math.PI * 2; if (da < -Math.PI) da += Math.PI * 2; r.yaw += da * Math.min(1, dt * 4); speed = 0.13; }
    } else if (r.state === 'scan') {
      r.scan += dt;
      if (r.scan > 3.2) { r.trips++; if (r.trips >= 3) r.state = 'out'; else { this.planRover(); r.state = r.pts.length ? 'drive' : 'out'; } }
    }
    r.wheel += (speed / (0.085 * H)) * dt;
    const y = W.groundAt(r.x, r.z);
    rig.put('ambRover', r.x, y, r.z, r.yaw, r.s);
    rig.bone('ambAxF').rotation.z = -r.wheel; rig.bone('ambAxR').rotation.z = -r.wheel;
    rig.bone('ambDish').rotation.y = r.state === 'scan' ? r.scan * 1.6 : W.clock * 0.5;
    rig.bone('ambDish').rotation.x = r.state === 'scan' ? -0.25 : 0;
    W.blobs.add(r.x, y + 0.004, r.z, H * 0.4 * r.s);
  }
  private planRover() {
    const W = this.W, r = this.rover;
    const from = W.hexAt(r.x, r.z);
    if (from < 0) { r.pts = []; return; }
    const used = W.usedHexes();
    const choices: number[] = [];
    for (let i = 0; i < W.grid.cells.length; i++) if (W.free[i] && !used.has(i) && i !== from) choices.push(i);
    if (!choices.length) { r.pts = []; return; }
    for (let tries = 0; tries < 6; tries++) {
      const to = choices[Math.floor(W.rnd() * choices.length)];
      const p = path(W.grid, from, to, W.free, 6);
      if (!p || p.length < 2 || p.some((h) => used.has(h))) continue;
      r.pts = []; r.pi = 1;
      for (const h of p.slice(1)) { const c = W.grid.cells[h]; r.pts.push(c.x + (W.rnd() - 0.5) * 0.1, c.z + (W.rnd() - 0.5) * 0.1); }
      r.pi = 0;
      return;
    }
    r.pts = [];
  }

  // ---- dust devils ---------------------------------------------------------------------------------------------------
  private tickDevils(dt: number) {
    const W = this.W;
    for (const d of this.devils) {
      if (!d.live) {
        d.wait -= dt;
        if (d.wait > 0) continue;
        const cs = W.grid.cells, free: number[] = [];
        for (let i = 0; i < cs.length; i++) if (W.free[i]) free.push(i);
        if (free.length < 4) { d.wait = 8; continue; }
        const h = free[Math.floor(W.rnd() * free.length)];
        d.live = true; d.hex = h; d.x = cs[h].x; d.z = cs[h].z; d.age = 0; d.life = 24 + W.rnd() * 18; d.tx = d.x; d.tz = d.z;
        continue;
      }
      d.age += dt; d.spin += dt * 6;
      if (W.usedHexes().has(d.hex)) d.age = Math.max(d.age, d.life - 1.2);
      const dx = d.tx - d.x, dz = d.tz - d.z, dd = Math.hypot(dx, dz);
      if (dd < 0.03) {
        const options = W.grid.nbr[d.hex].filter((j) => W.free[j]);
        if (options.length) { d.hex = options[Math.floor(W.rnd() * options.length)]; d.tx = W.grid.cells[d.hex].x + (W.rnd() - 0.5) * 0.15; d.tz = W.grid.cells[d.hex].z + (W.rnd() - 0.5) * 0.15; }
        else d.age = d.life;
      } else { d.x += (dx / dd) * 0.06 * dt; d.z += (dz / dd) * 0.06 * dt; }
      if (d.age >= d.life) { d.live = false; d.wait = 12 + W.rnd() * 25; continue; }
      // a dust devil is a spiral of dust puffs climbing and widening, not a solid shape
      const k = Math.min(1, d.age / 2, (d.life - d.age) / 2), y = W.groundAt(d.x, d.z);
      d.emit += dt * 26 * k;
      while (d.emit >= 1) {
        d.emit -= 1;
        const h = W.rnd(), a = d.spin + h * 12, r = (0.02 + h * 0.07) * 1.1;
        W.parts.emit(d.x + Math.sin(a) * r, y + 0.01 + h * 0.34, d.z + Math.cos(a) * r * 0.9, Math.cos(a) * 0.12, 0.02, -Math.sin(a) * 0.12, 0.7, 0.014 + h * 0.03, 0xdcb596, 0, 0.5, y);
      }
    }
  }

  // ---- the drone -----------------------------------------------------------------------------------------------------
  private cities(): number[] { const out: number[] = []; this.W.grid.cells.forEach((c, i) => { if (this.W.isCity(c.space)) out.push(i); }); return out; }

  private tickDrone(dt: number) {
    const W = this.W, d = this.drone, rig = W.rig;
    if (d.state === 'gone') {
      d.wait -= dt;
      if (d.wait > 0 || W.inUse.has('drone')) return;
      const cs = this.cities();
      if (cs.length < 2) { d.wait = 15; return; }
      d.a = cs[Math.floor(W.rnd() * cs.length)];
      do { d.b = cs[Math.floor(W.rnd() * cs.length)]; } while (d.b === d.a);
      d.state = 'out'; d.t = 0; d.s = 0; W.inUse.add('drone');
      rig.bone('drPkg').scale.setScalar(1);
    }
    const A = W.grid.cells[d.a], B = W.grid.cells[d.b];
    if (!A || !B || !W.isCity(A.space) || !W.isCity(B.space)) { d.state = 'gone'; d.wait = 20; rig.hide('drone'); W.inUse.delete('drone'); return; }
    const alt = 0.55 * 0.475 * 2.6 / LIFE_SCALE;
    const ya = W.heights[d.a] + alt, yb = W.heights[d.b] + alt;
    d.t += dt;
    const dist = Math.hypot(B.x - A.x, B.z - A.z), fly = dist / 0.38;
    let fx = A.x, fz = A.z, fy = ya;
    if (d.state === 'out') {
      const k = Math.min(1, d.t / fly), e = k * k * (3 - 2 * k);
      fx = A.x + (B.x - A.x) * e; fz = A.z + (B.z - A.z) * e; fy = ya + (yb - ya) * e + Math.sin(k * Math.PI) * 0.08;
      d.s = Math.min(1, d.t * 1.5);
      if (k >= 1) { d.state = 'drop'; d.t = 0; }
    } else if (d.state === 'drop') {
      fx = B.x; fz = B.z; fy = yb - Math.sin(Math.min(1, d.t / 1.2) * Math.PI) * 0.06;
      if (d.t > 0.9) { const s = Math.max(0, 1 - (d.t - 0.9) * 4); rig.bone('drPkg').scale.setScalar(s); if (s === 0 && d.t < 1.0) W.parts.burst(B.x, yb - 0.05, B.z, 6, 0.1, 0.1, 0.6, 0.012, 0xffd27a, 1); }
      if (d.t > 2.4) { d.state = 'back'; d.t = 0; }
    } else if (d.state === 'back') {
      const k = Math.min(1, d.t / fly), e = k * k * (3 - 2 * k);
      fx = B.x + (A.x - B.x) * e; fz = B.z + (A.z - B.z) * e; fy = yb + (ya - yb) * e + Math.sin(k * Math.PI) * 0.08;
      if (k >= 1) { d.state = 'away'; d.t = 0; }
    } else {
      fx = A.x; fz = A.z; fy = ya; d.s = Math.max(0, 1 - d.t * 2);
      if (d.s <= 0) { d.state = 'gone'; d.wait = 35 + W.rnd() * 30; rig.hide('drone'); W.inUse.delete('drone'); return; }
    }
    const bob = Math.sin(W.clock * 3) * 0.006;
    const yaw = Math.atan2(B.x - A.x, B.z - A.z) * (d.state === 'back' ? -1 : 1) + (d.state === 'back' ? Math.PI : 0);
    const b = rig.put('drone', fx, fy + bob, fz, yaw, d.s);
    b.rotation.x = d.state === 'out' || d.state === 'back' ? 0.18 : 0; b.rotation.order = 'YXZ';
    for (let i = 0; i < 4; i++) rig.bone(`drRot${i}`).rotation.y = W.clock * 40 * (i % 2 ? 1 : -1);
    W.blobs.add(fx, W.groundAt(fx, fz) + 0.004, fz, H * 0.28 * d.s);
    d.x = fx; d.z = fz; d.y = fy;
  }
}
