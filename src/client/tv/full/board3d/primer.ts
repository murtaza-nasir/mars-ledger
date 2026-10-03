// Paying for shader programs' first use ahead of the frame that needs them.
import type * as THREE from 'three';

/** Background compiles (gl.compileAsync) not settled yet. A first use is a synchronous call into the GPU process,
 *  which waits behind every link queued there, so nothing primes while compiles are in flight. */
let inFlight = 0;
export function compilesInFlight(): number { return inFlight; }
/** Track a background compile (the warm-up's, a tile's model prep). */
export function tracked<T>(p: Promise<T>): Promise<T | undefined> {
  inFlight++;
  return p.then((v) => v, () => undefined).finally(() => { inFlight--; });
}

/** Programs whose first use has been paid for (see primePrograms). */
const primed = new WeakSet<object>();
type Prog = {isReady?: () => boolean; getUniforms?: () => unknown};

/** three pays for a shader program's first use when it first draws with it: a handful of synchronous status and
 *  uniform queries (and a wait if the link is still running). Some 140 programs drawn for the first time in one frame
 *  (the first depth-of-field frame of a dive) cost 30–40 ms at 4K. This pays that cost ahead, at most one real first use per
 *  call, for programs whose background compile reports finished. Returns how many are left. */
export function primePrograms(gl: THREE.WebGLRenderer, maxChecks = 32): number {
  if (inFlight > 0) return unprimed(gl);
  const list = (gl.info as unknown as {programs?: Prog[]}).programs ?? [];
  let left = 0, checks = 0, done = false;
  for (const p of list) {
    if (primed.has(p)) continue;
    left++;
    if (done || checks >= maxChecks) continue;
    checks++;
    if (p.isReady && !p.isReady()) continue;
    // a program the board has drawn with already answers at once; only a real first use ends this frame's turn
    const t0 = performance.now();
    p.getUniforms?.();
    primed.add(p);
    if (performance.now() - t0 > 0.5) done = true;
    left--;
  }
  return left;
}

/** How many of the renderer's programs have not had their first use yet. */
export function unprimed(gl: THREE.WebGLRenderer): number {
  const list = (gl.info as unknown as {programs?: Prog[]}).programs ?? [];
  let n = 0;
  for (const p of list) if (!primed.has(p)) n++;
  return n;
}
