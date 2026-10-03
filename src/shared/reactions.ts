// Reactions: a player taps a sticker on their phone and it floats across the TV. Presentation only;
// reactions never enter the game log or the history.

export const STICKERS = ['ouch', 'nice', 'meteor', 'greenery', 'money', 'laugh', 'wow', 'gg'] as const;
export type StickerId = typeof STICKERS[number];

export const STICKER_LABEL: Record<StickerId, string> = {
  ouch: 'Ouch', nice: 'Nice', meteor: 'Meteor', greenery: 'Greenery', money: 'Money', laugh: 'Ha!', wow: 'Wow', gg: 'GG',
};

export function isSticker(x: unknown): x is StickerId {
  return typeof x === 'string' && (STICKERS as readonly string[]).includes(x);
}

/** Per player: at most REACTION_LIMIT reactions in any REACTION_WINDOW_MS. */
export const REACTION_LIMIT = 5;
export const REACTION_WINDOW_MS = 10_000;
/** Reactions arriving in a cinematic's (or the production show's) first second are dropped. */
export const REACTION_QUIET_MS = 1000;
/** The same sticker again within this window joins the sticker already on screen. */
export const REACTION_COMBINE_MS = 1500;
/** How long a sticker stays on the TV after its last addition. */
export const REACTION_LIFE_MS = 3000;

export type Reaction = {id: string; playerId: string; color: string; name: string; sticker: StickerId; at: number};

// ---- rate limit (server enforces; phones mirror it to show the cooldown) ----------------------
export class ReactionLimiter {
  private sent = new Map<string, number[]>();
  constructor(private limit = REACTION_LIMIT, private windowMs = REACTION_WINDOW_MS) {}

  /** Records the reaction if allowed; otherwise says how long until the next one is. */
  take(key: string, now: number): {ok: true} | {ok: false; retryInMs: number} {
    const recent = (this.sent.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.limit) {
      this.sent.set(key, recent);
      return {ok: false, retryInMs: recent[0] + this.windowMs - now};
    }
    recent.push(now);
    this.sent.set(key, recent);
    return {ok: true};
  }

  /** Milliseconds until `key` may react again (0 when it may now). */
  cooldown(key: string, now: number): number {
    const recent = (this.sent.get(key) ?? []).filter((t) => now - t < this.windowMs);
    return recent.length >= this.limit ? recent[0] + this.windowMs - now : 0;
  }
}

// ---- what the TV shows ------------------------------------------------------------------------
export type Sender = {playerId: string; name: string; color: string};

/** One sticker on the TV. Several reactions with the same sticker close together share one bubble. */
export type Bubble = {
  key: string;
  sticker: StickerId;
  senders: Sender[];
  /** reactions folded into this bubble (a repeat from the same player counts too) */
  count: number;
  bornAt: number;
  updatedAt: number;
  /** where it comes from: a player's strip, or the middle when several players joined in */
  anchor: string;
  /**
   * Stacking position within its lane, so simultaneous stickers never overlap: every sticker coming
   * from a strip shares one lane (strips sit close together, so separation must be sideways), and
   * combined stickers share the middle.
   */
  slot: number;
};

export const isCombined = (b: Bubble) => b.senders.length > 1;

export function liveBubbles(bubbles: Bubble[], now: number): Bubble[] {
  return bubbles.filter((b) => now - b.updatedAt < REACTION_LIFE_MS);
}

export const laneOf = (anchor: string) => (anchor === 'center' ? 'center' : 'side');

function freeSlot(bubbles: Bubble[], anchor: string, except?: string): number {
  const lane = laneOf(anchor);
  const used = new Set(bubbles.filter((b) => laneOf(b.anchor) === lane && b.key !== except).map((b) => b.slot));
  let s = 0;
  while (used.has(s)) s++;
  return s;
}

/**
 * Adds a reaction to what is on screen. Returns the new list and whether it made a new bubble (the TV
 * plays one sound per bubble, so a combined burst sounds once).
 */
export function addReaction(bubbles: Bubble[], r: Reaction, now: number): {bubbles: Bubble[]; created: boolean} {
  const live = liveBubbles(bubbles, now);
  const match = live.find((b) => b.sticker === r.sticker && now - b.updatedAt < REACTION_COMBINE_MS);
  if (match) {
    const senders = match.senders.some((s) => s.playerId === r.playerId) ? match.senders
      : [...match.senders, {playerId: r.playerId, name: r.name, color: r.color}];
    // A second player joining moves the bubble to the middle of the screen.
    const anchor = senders.length > 1 ? 'center' : match.anchor;
    const slot = laneOf(anchor) === laneOf(match.anchor) ? match.slot : freeSlot(live, anchor, match.key);
    const next: Bubble = {...match, senders, count: match.count + 1, updatedAt: now, anchor, slot};
    return {bubbles: live.map((b) => (b.key === match.key ? next : b)), created: false};
  }
  const anchor = r.color;
  const bubble: Bubble = {key: r.id, sticker: r.sticker, senders: [{playerId: r.playerId, name: r.name, color: r.color}], count: 1,
    bornAt: now, updatedAt: now, anchor, slot: freeSlot(live, anchor)};
  return {bubbles: [...live, bubble], created: true};
}

/** Was a quiet window (cinematic or production show start) open at `now`? */
export function inQuietWindow(starts: Array<number | null | undefined>, now: number, quietMs = REACTION_QUIET_MS): boolean {
  return starts.some((s) => typeof s === 'number' && now >= s && now - s < quietMs);
}
