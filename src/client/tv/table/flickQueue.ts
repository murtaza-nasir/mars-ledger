// Which flicked card the TV shows (TableLayer.tsx), as a pure rule. No imports: the tests load it without a page.

/** A flick that reaches the front of the queue later than this after it arrived is skipped (wasFlicked in flicks.ts looks back as far). */
export const FLICK_STALE_MS = 30_000;
/** A flick on screen has left by this long after its settle or cancel step began, whatever its animation did. */
export const FLICK_SETTLE_MAX_MS = 3500;

/**
 * The flick the TV shows now: the oldest that arrived while the TV was watching, is not done, names a card the TV knows,
 * and has not gone stale waiting behind the others. Pure; `done` is the ids already shown (or skipped).
 */
export function nextFlick<F extends {id: string; card: string; at: number}>(flicks: F[], done: ReadonlySet<string>, mountedAt: number, now: number,
  known: (card: string) => unknown): F | undefined {
  return flicks.find((f) => f.at >= mountedAt - 500 && !done.has(f.id) && !!known(f.card) && now - f.at <= FLICK_STALE_MS);
}
