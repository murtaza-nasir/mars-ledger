// Board life's timing, pure: when an ambient scene may begin, when something falls from the sky, when the table has
// been idle long enough for a game of catch. Times are seconds of the life clock (it stops while life is hidden) except
// idleness, which is wall-clock milliseconds because a quiet table is quiet whether or not life is showing.
export type AmbientKind = 'plant' | 'drill' | 'rover' | 'mop' | 'selfie' | 'nap';
export type FallKind = 'crate' | 'cow' | 'duck' | 'pizza' | 'junk';
export const AMBIENT_KINDS: AmbientKind[] = ['plant', 'drill', 'rover', 'mop', 'selfie', 'nap'];
export const FALL_KINDS: FallKind[] = ['crate', 'cow', 'duck', 'pizza', 'junk'];

export const LIFE = {
  /** the most characters and the most scenes at once */
  maxChars: 2, maxScenes: 2,
  /** a scene lasts this long once its character has arrived (s) */
  sceneMin: 6, sceneMax: 15,
  /** the pause between one ambient scene ending and the next beginning, per slot (s) */
  gapMin: 3, gapMax: 9,
  /** the first thing from the sky comes this long after life starts showing, then this long between (s) */
  fallFirst: [50, 90] as [number, number], fallEvery: [110, 210] as [number, number],
  /** nothing falls this soon after a reaction began (s), so the surprise stays a surprise */
  fallAfterReaction: 20,
  /** the table has made no move for this long (ms), and the next idle scene waits this long after one (ms) */
  idleMs: 90_000, idleRearmMs: 150_000,
} as const;

export type Rnd = () => number;
const between = (r: Rnd, [a, b]: readonly [number, number]) => a + r() * (b - a);

export type AmbientCtx = {
  scenesActive: number; charsFree: number;
  /** ambient kinds running now (a kind never runs twice at once) */
  kindsActive: ReadonlySet<AmbientKind>;
  eligible: (k: AmbientKind) => boolean;
};

export class LifeScheduler {
  private nextAmbientAt = 0;
  private nextFallAt = 0;
  private lastAmbient: AmbientKind[] = [];
  private lastFall: FallKind | null = null;
  private lastReactionAt = -1e9;
  private lastActivityMs = 0;
  private lastIdleMs = -1e12;

  constructor(private rnd: Rnd, private cfg: typeof LIFE = LIFE) {}

  /** Life began showing at life-clock time `now`, wall time `wallMs`. */
  start(now: number, wallMs: number) {
    this.nextAmbientAt = now + 2 + this.rnd() * 3;
    this.nextFallAt = now + between(this.rnd, this.cfg.fallFirst);
    this.lastActivityMs = wallMs;
  }

  noteActivity(wallMs: number) { this.lastActivityMs = wallMs; }
  /** Milliseconds since the table last moved. */
  quietMs(wallMs: number): number { return wallMs - this.lastActivityMs; }
  noteReaction(now: number) { this.lastReactionAt = now; this.nextFallAt = Math.max(this.nextFallAt, now + this.cfg.fallAfterReaction); }
  /** Ask for a scene sooner or later (the director calls this when a scene ends). */
  sceneEnded(now: number) { this.nextAmbientAt = Math.max(this.nextAmbientAt, now + this.cfg.gapMin + this.rnd() * (this.cfg.gapMax - this.cfg.gapMin)); }

  /** True once when the table has been quiet for idleMs (and not too soon after the last time). */
  idleDue(wallMs: number): boolean {
    if (wallMs - this.lastActivityMs < this.cfg.idleMs || wallMs - this.lastIdleMs < this.cfg.idleRearmMs) return false;
    this.lastIdleMs = wallMs;
    return true;
  }

  /** The next ambient scene to start, or null (too early, no room, nothing eligible). Chosen without repeating the last two kinds. */
  nextAmbient(now: number, c: AmbientCtx): AmbientKind | null {
    if (now < this.nextAmbientAt || c.scenesActive >= this.cfg.maxScenes || c.charsFree < 1) return null;
    let pool = AMBIENT_KINDS.filter((k) => !c.kindsActive.has(k) && c.eligible(k));
    const fresh = pool.filter((k) => !this.lastAmbient.includes(k));
    if (fresh.length) pool = fresh;
    if (!pool.length) { this.nextAmbientAt = now + 2; return null; }
    const k = pool[Math.min(pool.length - 1, Math.floor(this.rnd() * pool.length))];
    this.lastAmbient = [k, ...this.lastAmbient].slice(0, 2);
    this.nextAmbientAt = now + this.cfg.gapMin;
    return k;
  }

  /** The next thing to fall, or null. Rare by construction: a long first wait, a long cooldown. */
  nextFall(now: number, eligible: (k: FallKind) => boolean, busy: boolean): FallKind | null {
    if (busy || now < this.nextFallAt) return null;
    let pool = FALL_KINDS.filter((k) => eligible(k));
    if (this.lastFall && pool.length > 1) pool = pool.filter((k) => k !== this.lastFall);
    if (!pool.length) { this.nextFallAt = now + 10; return null; }
    const k = pool[Math.min(pool.length - 1, Math.floor(this.rnd() * pool.length))];
    this.lastFall = k;
    this.nextFallAt = now + between(this.rnd, this.cfg.fallEvery);
    return k;
  }

  /** For tests and the debug hook: make the next thing fall at once. */
  fallNow(now: number) { this.nextFallAt = now; }
  /** The earliest the next fall may begin (life-clock seconds). */
  get fallAt() { return this.nextFallAt; }
}
