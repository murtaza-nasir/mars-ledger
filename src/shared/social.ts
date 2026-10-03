// Table-side gestures between devices: a card flicked from a phone onto the TV, and a friendly nudge.
// These are presentation only; they never change the game.

/** A card leaving a phone for the table. Sent at release, before the rules have accepted the play. */
export type Flick = {id: string; playerId: string; color: string; name: string; card: string; at: number};

/** "X is waiting on you", relayed to the target's phone(s) and the TV. */
export type Nudge = {id: string; from: string; fromName: string; fromColor: string; to: string; toName: string; toColor: string; at: number};

/** Seconds a player must have been deciding before others can nudge them, and the per-sender cooldown. */
export const NUDGE_AFTER_MS = 45_000;
export const NUDGE_COOLDOWN_MS = 60_000;
