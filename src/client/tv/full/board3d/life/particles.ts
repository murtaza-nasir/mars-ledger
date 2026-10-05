// Small instanced extras for board life, all allocation-free per frame: a particle pool (puffs, drops, sparks,
// confetti: one InstancedMesh, one draw call), and blob shadows under characters and props (one more).
import * as THREE from 'three';

export const MAX_PARTICLES = 160;
export const MAX_BLOBS = 14;

const tmpCol = new THREE.Color();

export class Particles {
  readonly mesh: THREE.InstancedMesh;
  private px = new Float32Array(MAX_PARTICLES); private py = new Float32Array(MAX_PARTICLES); private pz = new Float32Array(MAX_PARTICLES);
  private vx = new Float32Array(MAX_PARTICLES); private vy = new Float32Array(MAX_PARTICLES); private vz = new Float32Array(MAX_PARTICLES);
  private life = new Float32Array(MAX_PARTICLES); private age = new Float32Array(MAX_PARTICLES); private size = new Float32Array(MAX_PARTICLES);
  private grav = new Float32Array(MAX_PARTICLES); private grow = new Float32Array(MAX_PARTICLES); private floor = new Float32Array(MAX_PARTICLES);
  private n = 0;
  private dirtyColor = true;

  constructor() {
    const geo = new THREE.IcosahedronGeometry(1, 0);
    const mat = new THREE.MeshBasicMaterial({color: '#ffffff'});
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX_PARTICLES);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PARTICLES * 3).fill(1), 3);
    this.mesh.frustumCulled = false;
    this.warm();
  }

  /** One zero-size particle stays in the draw, so the program, buffers and colours are used (and uploaded) from the first frame. */
  private warm() { this.n = 0; this.mesh.count = 1; (this.mesh.instanceMatrix.array as Float32Array).fill(0); this.mesh.instanceMatrix.needsUpdate = true; }

  get active() { return this.n; }

  /** One particle. `grow`: how its size changes over its life (1 shrinks to nothing, 0 holds, negative grows); `floor`: stops falling at this y. */
  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, color: number, gravity = 0, grow = 1, floor = -1e9) {
    let i = this.n;
    if (i >= MAX_PARTICLES) i = Math.floor(Math.random() * MAX_PARTICLES); // overwrite one: never allocate, never refuse
    else this.n++;
    this.px[i] = x; this.py[i] = y; this.pz[i] = z; this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.life[i] = life; this.age[i] = 0; this.size[i] = size; this.grav[i] = gravity; this.grow[i] = grow; this.floor[i] = floor;
    tmpCol.set(color);
    const c = this.mesh.instanceColor!.array as Float32Array;
    c[i * 3] = tmpCol.r; c[i * 3 + 1] = tmpCol.g; c[i * 3 + 2] = tmpCol.b;
    this.dirtyColor = true;
  }

  /** A ring of `n` particles thrown outward and up from a point. */
  burst(x: number, y: number, z: number, n: number, speed: number, up: number, life: number, size: number, color: number, gravity = 3, floor = -1e9) {
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + k * 0.7, s = speed * (0.55 + ((k * 37) % 10) / 22);
      this.emit(x, y, z, Math.sin(a) * s, up * (0.6 + ((k * 13) % 7) / 14), Math.cos(a) * s, life * (0.7 + ((k * 7) % 5) / 12), size, color, gravity, 1, floor);
    }
  }

  update(dt: number) {
    const arr = this.mesh.instanceMatrix.array as Float32Array;
    let i = 0;
    while (i < this.n) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) { this.copy(this.n - 1, i); this.n--; continue; }
      this.vy[i] -= this.grav[i] * dt;
      this.px[i] += this.vx[i] * dt; this.py[i] += this.vy[i] * dt; this.pz[i] += this.vz[i] * dt;
      if (this.py[i] < this.floor[i]) { this.py[i] = this.floor[i]; this.vy[i] = 0; this.vx[i] *= 0.5; this.vz[i] *= 0.5; }
      i++;
    }
    for (let j = 0; j < this.n; j++) {
      const k = this.age[j] / this.life[j];
      const s = this.size[j] * (this.grow[j] >= 0 ? 1 - this.grow[j] * k : 1 + -this.grow[j] * k) * Math.min(1, k * 12 + 0.25);
      const o = j * 16;
      arr[o] = s; arr[o + 1] = 0; arr[o + 2] = 0; arr[o + 3] = 0;
      arr[o + 4] = 0; arr[o + 5] = s; arr[o + 6] = 0; arr[o + 7] = 0;
      arr[o + 8] = 0; arr[o + 9] = 0; arr[o + 10] = s; arr[o + 11] = 0;
      arr[o + 12] = this.px[j]; arr[o + 13] = this.py[j]; arr[o + 14] = this.pz[j]; arr[o + 15] = 1;
    }
    this.mesh.count = Math.max(1, this.n);
    if (this.n === 0) (arr as Float32Array).fill(0, 0, 16);
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.dirtyColor) { this.mesh.instanceColor!.needsUpdate = true; this.dirtyColor = false; }
  }

  private copy(from: number, to: number) {
    if (from === to) return;
    this.px[to] = this.px[from]; this.py[to] = this.py[from]; this.pz[to] = this.pz[from]; this.vx[to] = this.vx[from]; this.vy[to] = this.vy[from]; this.vz[to] = this.vz[from];
    this.life[to] = this.life[from]; this.age[to] = this.age[from]; this.size[to] = this.size[from]; this.grav[to] = this.grav[from]; this.grow[to] = this.grow[from]; this.floor[to] = this.floor[from];
    const c = this.mesh.instanceColor!.array as Float32Array;
    c[to * 3] = c[from * 3]; c[to * 3 + 1] = c[from * 3 + 1]; c[to * 3 + 2] = c[from * 3 + 2];
    this.dirtyColor = true;
  }

  clear() { this.warm(); }
  dispose() { this.mesh.geometry.dispose(); (this.mesh.material as THREE.Material).dispose(); this.mesh.dispose(); }
}

/** Soft dark discs on the ground under moving things: positions are set each frame, nothing else. */
export class Blobs {
  readonly mesh: THREE.InstancedMesh;
  private n = 0;
  constructor() {
    const geo = new THREE.CircleGeometry(1, 14); geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({color: '#000000', transparent: true, opacity: 0.32, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2});
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX_BLOBS);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 2; this.mesh.count = 1;
  }
  begin() { this.n = 0; }
  add(x: number, y: number, z: number, r: number) {
    if (this.n >= MAX_BLOBS) return;
    const a = this.mesh.instanceMatrix.array as Float32Array, o = this.n * 16;
    a[o] = r; a[o + 1] = 0; a[o + 2] = 0; a[o + 3] = 0; a[o + 4] = 0; a[o + 5] = 1; a[o + 6] = 0; a[o + 7] = 0; a[o + 8] = 0; a[o + 9] = 0; a[o + 10] = r * 0.8; a[o + 11] = 0;
    a[o + 12] = x; a[o + 13] = y; a[o + 14] = z; a[o + 15] = 1;
    this.n++;
  }
  end() { if (!this.n) this.add(0, -50, 0, 0.001); this.mesh.count = this.n; this.mesh.instanceMatrix.needsUpdate = true; }
  dispose() { this.mesh.geometry.dispose(); (this.mesh.material as THREE.Material).dispose(); this.mesh.dispose(); }
}

/** A soft light ring on the ground under each figure, so it separates from the hex at a distance. */
export class Rings {
  readonly mesh: THREE.InstancedMesh;
  private n = 0;
  constructor() {
    const geo = new THREE.RingGeometry(0.72, 1, 28); geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({color: '#fff1d6', transparent: true, opacity: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3});
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX_BLOBS);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 2; this.mesh.count = 1;
    this.begin(); this.add(0, -50, 0, 0.001); this.end();
  }
  begin() { this.n = 0; }
  add(x: number, y: number, z: number, r: number) {
    if (this.n >= MAX_BLOBS) return;
    const a = this.mesh.instanceMatrix.array as Float32Array, o = this.n * 16;
    a[o] = r; a[o + 1] = 0; a[o + 2] = 0; a[o + 3] = 0; a[o + 4] = 0; a[o + 5] = 1; a[o + 6] = 0; a[o + 7] = 0; a[o + 8] = 0; a[o + 9] = 0; a[o + 10] = r * 0.85; a[o + 11] = 0;
    a[o + 12] = x; a[o + 13] = y; a[o + 14] = z; a[o + 15] = 1;
    this.n++;
  }
  end() { this.mesh.count = Math.max(1, this.n); if (!this.n) this.add(0, -50, 0, 0.001); this.mesh.instanceMatrix.needsUpdate = true; }
  dispose() { this.mesh.geometry.dispose(); (this.mesh.material as THREE.Material).dispose(); this.mesh.dispose(); }
}
