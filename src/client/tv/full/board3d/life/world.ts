// Board life's runtime: two miniature characters that appear, walk across empty hexes, do a scene, and vanish; the
// props, particles and shadows they share; the scheduler and reaction queue that decide what happens next; and the
// ambient life (rover, drone, dust devils, lichen). No React in here: the director (LifeDirector.tsx) feeds it the
// board, the camera's situation and the game's events once per frame, and it draws through three.js objects it owns.
// Nothing in a frame allocates: poses, paths and particles live in typed arrays made at the start.
import * as THREE from 'three';
import type {SpaceModel} from '../../../../../shared/full';
import {TILE} from '../../../../../shared/full';
import {prismHeight, PRISM_R} from '../geometry3d';
import {Ambient} from './ambient';
import {applyPose, makePose, snapPose} from './anim';
import type {PoseId, PoseState} from './anim';
import type {LifeEvent} from './events';
import {blockedFrom, buildGrid, freeMask, isFree, path, pickSite, walkPoints} from './hexgrid';
import type {Grid, SiteWant} from './hexgrid';
import {glow} from './kit';
import {lifeVisit} from './visit';
import {Blobs, Particles, Rings} from './particles';
import {CHAR_H, createProps, LIFE_SCALE} from './props';
import type {PropsRig} from './props';
import {idleReaction, reactionsFor, ReactionQueue} from './reactions';
import type {ReactionKind, ReactionRequest} from './reactions';
import {createCharacter, disposeCharacter, setFace} from './rig';
import type {Character} from './rig';
import {AMBIENT_SCENES, FALL_SCENES, REACTION_SCENES} from './scenes';
import {LIFE, LifeScheduler} from './scheduler';
import type {AmbientKind, FallKind} from './scheduler';
import type {CharacterSkin, FaceKey} from './skins';

export {LIFE_SCALE};
export const H = CHAR_H;
export const R = PRISM_R;
/** Walking pace, world units per second, and the distance one full step cycle covers. */
export const WALK = 0.36, RUN = 0.8, STRIDE = 0.15;
const TOP_LIFT = 0.0012;

export type Spot = {x: number; z: number; yaw: number};
export type SceneKind = AmbientKind | ReactionKind | FallKind;

export type SceneDef = {
  kind: SceneKind;
  /** characters it needs (0 for things falling from the sky) and how long the scene itself lasts (s) */
  chars: number; dur: number | [number, number];
  /** higher is more important when a reaction needs the room */
  priority: number;
  /** root parts it owns while it runs (no two scenes share one) */
  uses: string[];
  /** characters run to their places (cover from an impact) */
  run?: boolean;
  /** the clock time of the scene's punchline (a camera visit aims to arrive just before it) */
  punch?: number;
  /** time at which a frozen (reduced motion) tableau is held, if the scene makes one */
  tableau?: number;
  /** fills the scene's site and spots, or returns false when the board has no place for it */
  site: (W: LifeWorld, S: Scene, req?: ReactionRequest) => boolean;
  start?: (W: LifeWorld, S: Scene) => void;
  play: (W: LifeWorld, S: Scene, t: number, dt: number) => void;
  end?: (W: LifeWorld, S: Scene) => void;
};

/** A scene running now. The numbered fields are scratch space for the scene's own use (nothing is allocated per frame). */
export type Scene = {
  def: SceneDef; kind: SceneKind;
  chars: CharState[];
  spots: Spot[];
  hexes: number[];
  /** the site: its hex centre, the top of its hex, and a unit direction (toward a neighbouring ocean or city) */
  x: number; z: number; y: number; dx: number; dz: number;
  /** the hex a reaction waits beside (its target), and where the sky object lands */
  target: number; tx: number; tz: number; ty: number;
  phase: 'arrive' | 'play';
  t: number; /** the clock one frame ago (for one-off effects) */ tp: number; dur: number; waited: number;
  frozen: boolean;
  n0: number; n1: number; n2: number; n3: number;
};

export type CharState = {
  i: number; ch: Character; ps: PoseState;
  active: boolean; vis: number; visTarget: number;
  x: number; z: number; y: number; yaw: number; yawTarget: number;
  /** the walk: points as x, z pairs */
  pts: Float32Array; ptN: number; ptI: number; walking: boolean; speed: number; walkPose: PoseId;
  /** a pop-out to finish before popping in at `pending` */
  pending: Spot | null;
  scene: Scene | null;
  face: FaceKey; idleFor: number;
  /** tipping over (a tumble or a fall), radians */
  tilt: number; roll: number;
  /** extra height above the ground (a hop or a chair seat) */
  lift: number;
};

export type FrameCtx = {
  /** life is covered or paused: a card holds the board, a cinematic or the production show plays */
  hidden: boolean;
  night: number; reduced: boolean;
  cam: [number, number, number];
  /** 0 at the resting camera, 1 dived in */
  dive: number;
  /** a quiet moment the camera may visit a scene in: camera moves on, no hover, no pending card or placement */
  canVisit: boolean;
  /** hexes a camera dive is looking at: nothing stays near them */
  focus: readonly string[];
  oxygen: number;
  wallMs: number;
};

const tmpV = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
const angDiff = (a: number, b: number) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };

export class LifeWorld {
  readonly group = new THREE.Group();
  readonly rig: PropsRig = createProps();
  readonly parts = new Particles();
  readonly blobs = new Blobs();
  readonly rings = new Rings();
  readonly ambient: Ambient;
  chars: CharState[] = [];
  grid: Grid = buildGrid([]);
  heights: number[] = [];
  free: boolean[] = [];
  busy = new Set<string>();
  spaces = new Map<string, SpaceModel>();
  scenes: Scene[] = [];
  fall: Scene | null = null;
  inUse = new Set<string>();
  sched: LifeScheduler;
  queue = new ReactionQueue();
  /** when each tile was first seen on the board (wall ms), for reactions that wait for their tile to land */
  tileSeen = new Map<string, number>();
  /** the life clock (seconds shown), and the camera */
  clock = 0;
  camX = 0; camY = 5; camZ = 6;
  night = 0; reduced = false; oxygen = 0;
  /** how far down the camera is (0 at rest), the size factor it gives the figures (1 at rest, 0.5 in a dive), and the resting camera */
  dive = 0; k = 1; restX = 0; restY = 5; restZ = 6;
  hidden = true; started = false; lastWall = 0;
  /** the most recent scene kinds, for the debug view and tests */
  log: string[] = [];
  rnd: () => number;
  /** a character's frozen poses and a still scene when motion is reduced */
  frozen = false;
  /** test hook: nothing starts by itself (scenes are spawned by hand) */
  manual = false;
  private skinsKey = '';
  private focusHexes = new Set<number>();
  private budget = {draws: 0};

  constructor(seed = Date.now() & 0xffffff) {
    let a = seed >>> 0;
    this.rnd = () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    this.sched = new LifeScheduler(this.rnd);
    this.ambient = new Ambient(this);
    this.group.add(this.rig.group, this.parts.mesh, this.blobs.mesh, this.rings.mesh, ...this.ambient.meshes);
    this.group.visible = true;
    this.group.scale.setScalar(LIFE_SCALE);
  }

  // ---- skins ---------------------------------------------------------------------------------------------------------
  /** Dress the two characters (rebuilds their meshes when the skins change). */
  setSkins(skins: CharacterSkin[], key: string) {
    if (key === this.skinsKey && this.chars.length) return;
    this.skinsKey = key;
    for (const c of this.chars) { this.group.remove(c.ch.group); disposeCharacter(c.ch); }
    for (const S of [...this.scenes]) this.abort(S, 'skins');
    this.chars = [0, 1].map((i) => {
      const ch = createCharacter(skins[i % skins.length]);
      ch.group.scale.setScalar(0.0001);
      ch.group.rotation.order = 'YXZ';
      this.group.add(ch.group);
      return {i, ch, ps: makePose(), active: false, vis: 0, visTarget: 0, x: 0, z: 0, y: 0, yaw: 0, yawTarget: 0, pts: new Float32Array(48), ptN: 0, ptI: 0,
        walking: false, speed: WALK, walkPose: 'walk' as PoseId, pending: null, scene: null, face: 'neutral' as FaceKey, idleFor: 0, tilt: 0, roll: 0, lift: 0};
    });
  }

  /** No characters (the "Terraformers" option is off, or the quality ladder paused them): their meshes are disposed,
   *  their scenes end and queued reactions are dropped; the sky and the ambient life carry on without them. */
  clearChars() {
    if (!this.chars.length) return;
    for (const S of [...this.scenes]) this.abort(S, 'skins');
    // a sky scene that borrowed a character (the pizza's hungry arrival) lets go of it
    if (this.fall) { for (const c of this.fall.chars) c.scene = null; this.fall.chars = []; }
    for (const c of this.chars) { this.group.remove(c.ch.group); disposeCharacter(c.ch); }
    this.chars = [];
    this.skinsKey = '';
    this.queue = new ReactionQueue();
  }

  // ---- the board -----------------------------------------------------------------------------------------------------
  /** The board changed (a tile landed, a finger hovers, a placement is pending): which hexes are free now. */
  setBoard(boardCells: Array<{id: string; x: number; z: number; space: SpaceModel}>, busy: ReadonlySet<string>, wallMs: number) {
    const cells = boardCells.map((c) => ({id: c.id, x: c.x / LIFE_SCALE, z: c.z / LIFE_SCALE, space: c.space}));
    if (this.grid.cells.length !== cells.length) this.grid = buildGrid(cells);
    else cells.forEach((c, i) => { this.grid.cells[i].space = c.space; });
    this.busy = new Set(busy);
    this.heights = this.grid.cells.map((c) => (prismHeight(c.space) + TOP_LIFT) / LIFE_SCALE);
    this.free = freeMask(this.grid, this.busy);
    this.spaces = new Map(cells.map((c) => [c.id, c.space]));
    for (const c of this.grid.cells) {
      if (c.space.tileType !== undefined && !this.tileSeen.has(c.id)) this.tileSeen.set(c.id, wallMs);
      else if (c.space.tileType === undefined) this.tileSeen.delete(c.id);
    }
    // anyone standing on a hex that stopped being free has to go; a scene using it ends
    for (const S of [...this.scenes]) if (S.hexes.some((h) => !this.free[h])) this.abort(S, 'occupied');
    if (this.fall && this.fall.hexes.some((h) => !this.free[h])) this.abort(this.fall, 'occupied');
    for (const c of this.chars) if (c.active && !c.scene) { const h = this.hexAt(c.x, c.z); if (h >= 0 && !this.free[h]) this.popOut(c); }
    this.ambient.board();
  }

  hexAt(x: number, z: number): number {
    let best = -1, bd = Infinity;
    const cs = this.grid.cells;
    for (let i = 0; i < cs.length; i++) { const d = (cs[i].x - x) ** 2 + (cs[i].z - z) ** 2; if (d < bd) { bd = d; best = i; } }
    return bd <= (this.grid.pitch * 0.62) ** 2 ? best : -1;
  }

  /** The ground's height at a point: the hex top, eased across the seam so walking never steps. */
  groundAt(x: number, z: number): number {
    const cs = this.grid.cells;
    let a = -1, b = -1, da = Infinity, db = Infinity;
    for (let i = 0; i < cs.length; i++) {
      const d = Math.hypot(cs[i].x - x, cs[i].z - z);
      if (d < da) { db = da; b = a; da = d; a = i; } else if (d < db) { db = d; b = i; }
    }
    if (a < 0) return 0;
    if (b < 0) return this.heights[a];
    const t = da / (da + db);
    const w = Math.min(1, Math.max(0, (t - 0.38) / 0.24));
    return this.heights[a] + (this.heights[b] - this.heights[a]) * (w * w * (3 - 2 * w));
  }

  camYaw(x: number, z: number): number { return Math.atan2(this.camX - x, this.camZ - z); }

  // ---- characters ----------------------------------------------------------------------------------------------------
  popIn(c: CharState, x: number, z: number, yaw: number) {
    c.active = true; c.x = x; c.z = z; c.y = this.groundAt(x, z); c.yaw = c.yawTarget = yaw; c.vis = 0; c.visTarget = 1; c.walking = false; c.pending = null;
    c.tilt = 0; c.roll = 0; c.lift = 0; c.idleFor = 0;
    c.ps.pose = 'idle'; c.ps.t = 0; c.ps.a = 0; c.ps.b = 0; snapPose(c.ps);
    for (let k = 0; k < 7; k++) this.parts.emit(x + (this.rnd() - 0.5) * H * 0.4, c.y + 0.01, z + (this.rnd() - 0.5) * H * 0.4, (this.rnd() - 0.5) * 0.14, 0.12 + this.rnd() * 0.12, (this.rnd() - 0.5) * 0.14, 0.6, H * 0.05, k % 2 ? 0xbfefff : 0xffffff, 0.2, 1);
  }

  popOut(c: CharState) {
    if (!c.active) return;
    c.visTarget = 0; c.walking = false;
    for (let k = 0; k < 5; k++) this.parts.emit(c.x + (this.rnd() - 0.5) * H * 0.4, c.y + 0.02, c.z + (this.rnd() - 0.5) * H * 0.4, (this.rnd() - 0.5) * 0.1, 0.1 + this.rnd() * 0.1, (this.rnd() - 0.5) * 0.1, 0.5, H * 0.045, 0xe8f6ff, 0.2, 1);
  }

  /** Send a character to a spot: walk there over free hexes when it is near, else vanish here and appear there. */
  sendTo(c: CharState, spot: Spot, run = false) {
    c.yawTarget = spot.yaw;
    if (!c.active) { this.popIn(c, spot.x, spot.z, spot.yaw); return; }
    const from = this.hexAt(c.x, c.z), to = this.hexAt(spot.x, spot.z);
    const p = from >= 0 && to >= 0 ? path(this.grid, from, to, this.free, 6) : null;
    if (!p || c.visTarget === 0) { c.pending = spot; this.popOut(c); return; }
    const pts = walkPoints(this.grid, p, {x: c.x, z: c.z}, spot);
    c.ptN = Math.min(pts.length, 24); c.ptI = 1;
    for (let k = 0; k < c.ptN; k++) { c.pts[k * 2] = pts[k].x; c.pts[k * 2 + 1] = pts[k].z; }
    c.walking = c.ptN > 1; c.speed = run ? RUN : WALK; c.walkPose = run ? 'run' : 'walk';
  }

  private updateChar(c: CharState, dt: number) {
    if (!c.active) return;
    c.vis += (c.visTarget - c.vis) * Math.min(1, dt * (c.visTarget > c.vis ? 9 : 14));
    if (c.visTarget === 0 && c.vis < 0.04) {
      c.active = false; c.vis = 0; c.ch.group.scale.setScalar(0.0001);
      if (c.pending) { const p = c.pending; c.pending = null; this.popIn(c, p.x, p.z, p.yaw); }
      return;
    }
    if (c.walking) {
      const tx = c.pts[c.ptI * 2], tz = c.pts[c.ptI * 2 + 1];
      const dx = tx - c.x, dz = tz - c.z, d = Math.hypot(dx, dz), step = c.speed * dt;
      if (d <= step) { c.x = tx; c.z = tz; c.ptI++; if (c.ptI >= c.ptN) { c.walking = false; } }
      else { c.x += (dx / d) * step; c.z += (dz / d) * step; c.yawTarget = Math.atan2(dx, dz); c.yaw += angDiff(c.yaw, c.yawTarget) * Math.min(1, dt * 10); }
      c.ps.ph += (step / STRIDE) * Math.PI * 2;
      if (c.ps.pose !== c.walkPose) { c.ps.pose = c.walkPose; }
      if (!c.walking) { c.ps.pose = 'idle'; }
    } else {
      c.yaw += angDiff(c.yaw, c.yawTarget) * Math.min(1, dt * 7);
      if (!c.scene && c.ps.pose !== 'idle' && c.ps.pose !== 'wave') c.ps.pose = 'idle';
    }
    c.y = this.groundAt(c.x, c.z);
  }

  private placeChar(c: CharState, dt: number) {
    if (!c.active) return;
    const g = c.ch.group, bh = c.ch.skin.build.height;
    const s = H * this.k * Math.max(0.001, c.vis * (1 + 0.18 * Math.sin(Math.min(1, c.vis) * Math.PI)));
    g.position.set(c.x, c.y + c.lift, c.z);
    g.rotation.set(c.tilt, c.yaw, c.roll);
    g.scale.set(s, s * bh, s);
    applyPose(c.ch, c.ps, dt);
    this.blobs.add(c.x, c.y + 0.004, c.z, H * 0.34 * c.vis * this.k);
    this.rings.add(c.x, c.y + 0.005, c.z, H * 0.62 * c.vis * this.k);
  }

  setFace(c: CharState, k: FaceKey) { if (c.face !== k) { c.face = k; setFace(c.ch, k); } }

  // ---- scenes --------------------------------------------------------------------------------------------------------
  private freeChars(n: number): CharState[] | null {
    if (!this.chars.length) return null;
    const pool = this.chars.filter((c) => !c.scene).sort((a, b) => (b.active ? 1 : 0) - (a.active ? 1 : 0) || a.i - b.i);
    return pool.length >= n ? pool.slice(0, n) : null;
  }

  private canUse(def: SceneDef): boolean { return def.uses.every((u) => !this.inUse.has(u)); }

  /** Count of scenes that hold characters. */
  get busyScenes() { return this.scenes.length; }
  get charsFree() { return this.chars.filter((c) => !c.scene).length; }

  startScene(def: SceneDef, req?: ReactionRequest, force = false): Scene | null {
    if (!this.canUse(def)) return null;
    const isFall = def.chars === 0;
    if (isFall ? !!this.fall : this.scenes.length >= LIFE.maxScenes && !force) return null;
    let cs: CharState[] = [];
    if (def.chars > 0) { const f = this.freeChars(def.chars); if (!f) return null; cs = f; }
    const S: Scene = {def, kind: def.kind, chars: cs, spots: [{x: 0, z: 0, yaw: 0}, {x: 0, z: 0, yaw: 0}], hexes: [], x: 0, z: 0, y: 0, dx: 0, dz: 1, target: -1, tx: 0, tz: 0, ty: 0,
      phase: 'arrive', t: 0, tp: -1, dur: Array.isArray(def.dur) ? def.dur[0] + this.rnd() * (def.dur[1] - def.dur[0]) : def.dur, waited: 0, frozen: false, n0: 0, n1: 0, n2: 0, n3: 0};
    if (!def.site(this, S, req)) return null;
    for (const u of def.uses) this.inUse.add(u);
    for (const c of cs) c.scene = S;
    if (isFall) this.fall = S; else this.scenes.push(S);
    this.usedDirty = true;
    this.log.push(def.kind); if (this.log.length > 30) this.log.shift();
    def.start?.(this, S);
    cs.forEach((c, k) => this.sendTo(c, S.spots[k], !!def.run));
    if (!cs.length) S.phase = 'play';
    return S;
  }

  abort(S: Scene, why: 'hide' | 'occupied' | 'preempt' | 'skins' | 'done') {
    S.def.end?.(this, S);
    for (const u of S.def.uses) { this.inUse.delete(u); this.rig.hide(u); }
    for (const c of S.chars) {
      c.scene = null; c.tilt = 0; c.roll = 0; c.lift = 0; c.walking = false; c.ch.group.rotation.set(0, c.yaw, 0);
      this.setFace(c, 'neutral'); c.ps.pose = 'idle'; c.ps.a = 0; c.ps.b = 0;
      if (why === 'hide' || why === 'occupied' || why === 'skins') this.popOut(c);
    }
    if (this.fall === S) this.fall = null;
    const i = this.scenes.indexOf(S);
    if (i >= 0) this.scenes.splice(i, 1);
    this.usedDirty = true;
    if (why === 'done') this.sched.sceneEnded(this.clock);
  }

  private updateScene(S: Scene, dt: number) {
    if (S.phase === 'arrive') {
      S.waited += dt;
      let ready = true;
      for (let k = 0; k < S.chars.length; k++) {
        const c = S.chars[k];
        if (!(c.active && !c.walking && !c.pending && c.vis > 0.95)) ready = false;
        else if (c.visTarget === 1) c.yawTarget = S.spots[k].yaw;
      }
      if (ready) { S.phase = 'play'; S.t = 0; }
      else if (S.waited > 14) this.abort(S, 'done');
      return;
    }
    if (!S.frozen) S.t += dt;
    S.def.play(this, S, S.t, dt);
    S.tp = S.t;
    if (S.t >= S.dur) this.abort(S, 'done');
  }

  /** Reaction scenes: find the best place and start the scene, pushing an ambient one aside when there is no room. */
  private startReaction(req: ReactionRequest): boolean {
    const def = REACTION_SCENES[req.kind];
    if (!def) return true;
    if (this.scenes.length >= LIFE.maxScenes || (def.chars > 0 && !this.freeChars(def.chars))) {
      const victim = [...this.scenes].filter((s) => s.def.priority < def.priority).sort((a, b) => a.def.priority - b.def.priority)[0];
      if (!victim) return false;
      this.abort(victim, 'preempt');
    }
    const S = this.startScene(def, req);
    if (S) this.sched.noteReaction(this.clock);
    return !!S;
  }

  // ---- events from the game --------------------------------------------------------------------------------------
  /** Events arrive after the move pipeline has them: they only queue requests (nothing here can delay a move). */
  onEvents(events: readonly LifeEvent[], wallMs: number) {
    if (!this.chars.length) return;
    if (events.length) this.sched.noteActivity(wallMs);
    this.queue.push(reactionsFor(events, wallMs, this.rnd), wallMs);
  }

  /** A reaction beside a tile starts once the tile has landed and its build-in has played. */
  private ready(r: ReactionRequest, wallMs: number): boolean {
    if (r.spaceId) { const seen = this.tileSeen.get(r.spaceId); return seen !== undefined && wallMs - seen >= 3000; }
    return true;
  }

  // ---- the frame -----------------------------------------------------------------------------------------------------
  tick(dt: number, f: FrameCtx) {
    dt = Math.min(dt, 0.1);
    this.camX = f.cam[0] / LIFE_SCALE; this.camY = f.cam[1] / LIFE_SCALE; this.camZ = f.cam[2] / LIFE_SCALE;
    this.dive = f.dive; this.k += (1 - 0.5 * f.dive - this.k) * Math.min(1, dt * 5);
    this.rig.k = this.k;
    if (f.dive < 0.05) { this.restX = this.camX; this.restY = this.camY; this.restZ = this.camZ; }
    this.night = f.night; glow.value = f.night;
    this.oxygen = f.oxygen;
    const wasReduced = this.reduced;
    this.reduced = f.reduced;
    this.focusHexes.clear();
    for (const id of f.focus) { const h = this.grid.byId.get(id); if (h !== undefined) this.focusHexes.add(h); }
    if (!this.grid.cells.length) return;

    if (f.hidden) {
      if (!this.hidden) this.hide();
      return;
    }
    if (this.hidden) { this.hidden = false; this.sched.start(this.clock, f.wallMs); this.started = true; this.group.visible = true; this.ambient.show(); }
    if (f.reduced !== wasReduced) { this.hide(); this.hidden = false; this.sched.start(this.clock, f.wallMs); }
    this.clock += dt;

    // a camera dive: nothing near its focus stays
    if (this.focusHexes.size) {
      for (let i = this.scenes.length - 1; i >= 0; i--) if (this.near(this.scenes[i].hexes)) this.abort(this.scenes[i], 'hide');
      if (this.fall && this.near(this.fall.hexes)) this.abort(this.fall, 'hide');
      for (const c of this.chars) if (c.active && !c.scene && this.near([this.hexAt(c.x, c.z)])) this.popOut(c);
    }

    if (f.reduced) { this.tickStill(f); return; }

    // what happens next
    const wall = f.wallMs;
    this.decide += dt;
    this.deciding = this.decide >= 0.4;
    if (this.deciding) this.decide = 0;
    const req = this.chars.length && this.queue.waiting.length && this.deciding ? this.queue.take(wall, (r) => this.ready(r, wall) && !this.focusClose(r)) : null;
    if (req && !this.startReaction(req)) this.queue.push([{...req, at: Math.max(req.at, wall - req.ttl + 8000)}], wall - 1e9);
    if (this.deciding && !this.manual) {
      if (this.chars.length && this.sched.idleDue(wall)) { const r = idleReaction(wall, this.rnd); if (!this.startReaction(r)) this.queue.push([r], wall - 1e9); }
      const kinds = new Set<AmbientKind>(this.scenes.map((s) => s.kind as AmbientKind));
      const k = this.sched.nextAmbient(this.clock, {scenesActive: this.scenes.length, charsFree: this.charsFree, kindsActive: kinds,
        eligible: (kind) => this.eligible(AMBIENT_SCENES[kind])});
      if (k) { const S = this.startScene(AMBIENT_SCENES[k]); if (!S) this.sched.sceneEnded(this.clock - 4); }
      const fk = this.sched.nextFall(this.clock, (kind) => this.eligible(FALL_SCENES[kind]), !!this.fall || this.scenes.some((s) => s.def.priority >= 6));
      if (fk) this.startScene(FALL_SCENES[fk]);
    }

    this.blobs.begin(); this.rings.begin();
    for (let i = this.scenes.length - 1; i >= 0; i--) this.updateScene(this.scenes[i], dt);
    if (this.fall) this.updateScene(this.fall, dt);
    for (const c of this.chars) {
      // a free character that has nothing to do for a while goes home
      if (c.active && !c.scene) { c.idleFor += dt; if (c.idleFor > 5.5 && c.visTarget === 1 && !c.walking) this.popOut(c); } else c.idleFor = 0;
      this.updateChar(c, dt);
      this.placeChar(c, dt);
    }
    this.ambient.tick(dt, f);
    this.parts.update(dt);
    this.blobs.end(); this.rings.end();
    this.visitTick(f);
    this.watchSight(dt);
  }

  /** Reduced motion: still scenes only (the poses are held, nothing walks, falls or drives). */
  private tickStill(f: FrameCtx) {
    if (!this.stillDone) {
      this.stillDone = true;
      this.blobs.begin(); this.rings.begin();
      for (const kind of ['nap', 'selfie'] as AmbientKind[]) {
        const def = AMBIENT_SCENES[kind];
        const S = this.startScene(def, undefined, true);
        if (!S) continue;
        S.frozen = true;
        for (const [k, c] of S.chars.entries()) { c.active = true; c.vis = 1; c.visTarget = 1; c.walking = false; c.x = S.spots[k].x; c.z = S.spots[k].z; c.yaw = c.yawTarget = S.spots[k].yaw; c.pending = null; }
        S.phase = 'play'; S.t = def.tableau ?? 3;
      }
      for (const S of this.scenes) { S.def.play(this, S, S.t, 0); }
      for (const c of this.chars) { c.y = this.groundAt(c.x, c.z); for (let n = 0; n < 4; n++) snapPose(c.ps); this.placeChar(c, 10); for (let n = 0; n < 3; n++) applyPose(c.ch, c.ps, 10); }
      this.ambient.still();
      this.blobs.end(); this.rings.end();
    }
  }
  private stillDone = false;
  private decide = 0;
  private deciding = false;

  /** Whether any of these hexes lies within two hexes of what a camera dive is looking at. */
  private near(hexes: readonly number[]): boolean {
    const cs = this.grid.cells, r = this.grid.pitch * 2.1;
    for (const h of hexes) {
      if (h < 0) continue;
      for (const f of this.focusHexes) if (Math.hypot(cs[h].x - cs[f].x, cs[h].z - cs[f].z) < r) return true;
    }
    return false;
  }
  private focusClose(r: ReactionRequest): boolean { return !!r.spaceId && this.focusHexes.size > 0 && this.near([this.grid.byId.get(r.spaceId) ?? -1]); }

  private hide() {
    this.hidden = true; this.stillDone = false;
    for (const S of [...this.scenes]) this.abort(S, 'hide');
    if (this.fall) this.abort(this.fall, 'hide');
    for (const c of this.chars) { c.active = false; c.vis = 0; c.visTarget = 0; c.pending = null; c.ch.group.scale.setScalar(0.0001); c.scene = null; }
    this.rig.hideAll(); this.inUse.clear();
    this.parts.clear();
    this.blobs.begin(); this.blobs.end(); this.rings.begin(); this.rings.end();
    this.ambient.hide();
    lifeVisit.until = 0;
  }

  /** Whether a scene could run on the board now (it has a place and its parts are free). */
  eligible(def: SceneDef): boolean {
    if (!this.canUse(def) || (def.chars > 0 && !this.freeChars(def.chars))) return false;
    const probe: Scene = {def, kind: def.kind, chars: [], spots: [{x: 0, z: 0, yaw: 0}, {x: 0, z: 0, yaw: 0}], hexes: [], x: 0, z: 0, y: 0, dx: 0, dz: 1, target: -1, tx: 0, tz: 0, ty: 0, phase: 'arrive', t: 0, tp: -1, dur: 1, waited: 0, frozen: false, n0: 0, n1: 0, n2: 0, n3: 0};
    return def.site(this, probe);
  }

  // ---- helpers for scenes ------------------------------------------------------------------------------------------
  /** Hexes in use by scenes (cached: the ambient pieces ask every frame). */
  usedHexes(): ReadonlySet<number> {
    if (this.usedDirty) {
      this.usedSet.clear();
      for (const S of this.scenes) for (const h of S.hexes) this.usedSet.add(h);
      if (this.fall) for (const h of this.fall.hexes) this.usedSet.add(h);
      this.usedDirty = false;
    }
    return this.usedSet;
  }
  private usedSet = new Set<number>();
  private usedDirty = true;

  /** A free hex for a scene: near the first free character when there is one (it walks), away from other scenes. */
  siteFor(want: SiteWant = {}, near?: number): number | null {
    const act = this.chars.find((c) => c.active && !c.scene);
    const from = near ?? (act ? this.hexAt(act.x, act.z) : undefined);
    const exclude = new Set(this.usedHexes());
    for (const c of this.chars) if (c.scene) { const h = this.hexAt(c.x, c.z); if (h >= 0) exclude.add(h); }
    for (const visible of [true, false]) for (const bonusFree of [true, false]) {
      const w: SiteWant = {bonusFree, ...want, exclude, visible: visible ? (i: number) => !this.blocked(i) : undefined};
      if (from !== undefined && from >= 0 && this.free[from]) { const s = pickSite(this.grid, this.free, this.rnd(), {...w, maxSteps: 5}, from); if (s !== null) return s; }
      const s = pickSite(this.grid, this.free, this.rnd(), w);
      if (s !== null) return s;
    }
    return null;
  }

  /** Whether a tall tile stands between the resting camera and a figure on hex i. */
  blocked(i: number): boolean {
    return blockedFrom(this.grid, i, {x: this.restX, y: this.restY, z: this.restZ}, (sp) => this.topOf(sp), H * 0.7, this.heights);
  }
  private topOf(sp: SpaceModel): number {
    if (sp.tileType === undefined || sp.tileType === TILE.OCEAN) return 0.05;
    return (sp.tileType === TILE.GREENERY ? 1.0 : 1.6) * PRISM_R / LIFE_SCALE;
  }

  /** At rest, scenes whose figures a tall tile now hides give way to others (a later placement can hide one). */
  private sight = 0;
  private watchSight(dt: number) {
    this.sight += dt;
    if (this.sight < 0.6 || this.dive > 0.05) return;
    this.sight = 0;
    for (let i = this.scenes.length - 1; i >= 0; i--) { const S = this.scenes[i]; if (S.def.priority < 4 && !S.frozen && S.hexes.length && this.blocked(S.hexes[0])) this.abort(S, 'hide'); }
  }

  // ---- visits: a gentle camera pass toward a vignette's punchline when the table is quiet -----------------------------
  lastVisit = -1e12; nextVisitGap = 150_000; forceVisit = false; private forcedRun = false;
  private visitTick(f: FrameCtx) {
    const now = performance.now();
    if (lifeVisit.until > now && !(f.canVisit || this.forcedRun)) { lifeVisit.until = 0; return; }
    if (lifeVisit.until <= now) this.forcedRun = false;
    if (lifeVisit.until > now || f.reduced) return;
    if (!this.forceVisit && (!f.canVisit || this.sched.quietMs(f.wallMs) < 20_000 || f.wallMs - this.lastVisit < this.nextVisitGap)) return;
    for (const S of this.scenes) {
      const p = S.def.punch;
      if (p === undefined || S.phase !== 'play' || S.frozen || S.t < p - 4.2 || S.t > p - 3) continue;
      lifeVisit.ids = [this.grid.cells[S.hexes[0]].id];
      lifeVisit.until = now + 7000;
      this.lastVisit = f.wallMs; this.nextVisitGap = 120_000 + this.rnd() * 60_000; this.forcedRun = this.forceVisit; this.forceVisit = false;
      return;
    }
  }

  /** Fill the scene's site fields from a hex. */
  setSite(S: Scene, hex: number) {
    const c = this.grid.cells[hex];
    S.hexes = [hex]; S.x = c.x; S.z = c.z; S.y = this.heights[hex];
  }

  /** Direction (unit) from the scene's hex toward a neighbour with `pred`, or false. */
  faceNeighbour(S: Scene, pred: (s: SpaceModel) => boolean): boolean {
    const hex = S.hexes[0];
    for (const n of this.grid.nbr[hex]) {
      const c = this.grid.cells[n];
      if (!pred(c.space)) continue;
      const dx = c.x - S.x, dz = c.z - S.z, d = Math.hypot(dx, dz);
      S.dx = dx / d; S.dz = dz / d; S.target = n; S.tx = c.x; S.tz = c.z; S.ty = this.heights[n];
      return true;
    }
    return false;
  }

  isOcean = (s: SpaceModel) => s.tileType === TILE.OCEAN;
  isCity = (s: SpaceModel) => s.tileType === TILE.CITY || s.tileType === TILE.CAPITAL;

  /** Quaternion-free pointing of a part's +y toward a point (for the fishing line). */
  aim(bone: THREE.Object3D, fx: number, fy: number, fz: number, tx: number, ty: number, tz: number): number {
    tmpV.set(tx - fx, ty - fy, tz - fz);
    const len = tmpV.length();
    if (len > 1e-5) { tmpV.multiplyScalar(1 / len); bone.quaternion.setFromUnitVectors(UP, tmpV); }
    bone.position.set(fx, fy, fz);
    return len;
  }

  // ---- budget and debug -------------------------------------------------------------------------------------------
  /** Draw calls this world adds: characters (one each), props, particles, blobs, and the ambient meshes. */
  drawCalls(): number {
    let n = 0;
    this.group.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.visible) n++; });
    this.budget.draws = n;
    return n;
  }

  triangles(): number {
    let t = 0;
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && o.visible && m.geometry.index) t += (m.geometry.index.count / 3) * ((m as THREE.InstancedMesh).isInstancedMesh ? (m as THREE.InstancedMesh).count : 1);
    });
    return t;
  }

  /** Debug: start a named scene now (a reaction, ambient or sky kind). */
  spawn(kind: string): string {
    const def = (AMBIENT_SCENES as Record<string, SceneDef>)[kind] ?? (REACTION_SCENES as Record<string, SceneDef>)[kind] ?? (FALL_SCENES as Record<string, SceneDef>)[kind];
    if (!def) return 'unknown';
    if (def.chars === 0 && this.fall) this.abort(this.fall, 'done');
    if (def.chars > 0 && this.scenes.length >= LIFE.maxScenes) this.abort(this.scenes[0], 'preempt');
    const req: ReactionRequest = {kind: kind as ReactionKind, at: Date.now(), ttl: 1e5, priority: def.priority};
    const S = this.startScene(def, def.kind in REACTION_SCENES ? req : undefined, true);
    return S ? 'ok' : 'no site';
  }

  dispose() {
    for (const c of this.chars) disposeCharacter(c.ch);
    this.rig.dispose(); this.parts.dispose(); this.blobs.dispose(); this.rings.dispose(); this.ambient.dispose();
  }

  // exposed for scenes and tests
  readonly util = {isFree};
}

export {setFace};
