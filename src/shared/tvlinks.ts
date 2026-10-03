// Phone-to-TV links (full games): a phone asks the TV to show a move again (replay), to point at the place or the
// tracker a move changed (map echo), and the TV says when a hit resolves on screen so the victim's phone buzzes with
// it (timed haptics). The rules live here, pure, so tests/tvlinks.test.ts can run them without sockets:
//   - ReplayDesk: one replay per phone at a time, then a cooldown
//   - EchoLimiter: a short gap between echoes from one phone
//   - HapticRelay: which phones buzz for a hit, and when (the TV's resolve, or a fallback at notice time)
import type {Color} from './full';

// ---- what travels -------------------------------------------------------------------------------------------------
/** The move a phone asks to see again, read from its log (src/client/phone/full/logLinks.ts). */
export type ReplayMove = {
  /** the log entry's key, so the TV can tell two asks for the same move apart from two moves */
  key: string;
  by: Color;
  /** played, used (a card action), project (a standard project), standard (a standard action), milestone, award, ... */
  how: string;
  /** the move's card (a project card, a corporation, 'Asteroid:SP'); null for milestones, awards and conversions */
  card: string | null;
  /** cards whose action was used, when the move used one (the TV's action moment shows the first) */
  cards?: string[];
  /** the move's one-line summary in plain words ("+2 plant production · placed a greenery") */
  line?: string;
  /** what the mover gained (resource tokens fly from the card to their panel on the TV, visual only) */
  gains?: Array<{r: 'megacredits' | 'steel' | 'titanium' | 'plants' | 'energy' | 'heat'; n: number; prod: boolean}>;
  /** the first space the move placed a tile on (the TV pings it) */
  spaceId?: string;
  /** players the move hurt, with what they lost */
  targets?: Array<{color: Color; losses: Array<{what: 'stock' | 'production' | 'tr' | 'card'; resource?: string; card?: string; amount: number}>}>;
};

export type Asker = {id: string; name: string; color: Color};

/** A replay as the TV receives it: the move, and who asked ("Vera asked to see this again"). */
export type Replay = {id: string; from: Asker; move: ReplayMove; at: number};

/** What a map echo points at on the TV. */
export type EchoTarget =
  | {kind: 'space'; spaceId: string}
  | {kind: 'global'; param: 'temperature' | 'oxygen' | 'oceans'}
  | {kind: 'res'; color: Color; resource: 'megacredits' | 'steel' | 'titanium' | 'plants' | 'energy' | 'heat'}
  | {kind: 'tr'; color: Color};

export type Echo = {id: string; from: Asker; targets: EchoTarget[]; at: number};

/** The TV reached a moment's phase on screen. Today only a hit's resolution ('resolve') is reported. */
export type TvMoment = {phase: 'resolve'; gameAge: number; attacker: Color; targets: Color[]; at: number};

/** Sent to a hit seat's phones: buzz now. `synced`: on the TV's resolve (else the fallback at notice time). */
export type HapticHit = {attacker: Color | null; synced: boolean; pattern: number[]};

// ---- timings ------------------------------------------------------------------------------------------------------
/** How long the TV pulses an echo's targets. */
export const ECHO_MS = 3000;
/** Gap between two echoes from one phone. */
export const ECHO_GAP_MS = 1500;
/** Cooldown after a phone's replay finished on the TV. */
export const REPLAY_COOLDOWN_MS = 3000;
/**
 * A replay waits behind live moments; if the TV never says it finished (a TV reloading, a socket gone), the phone may
 * ask again after this long.
 */
export const REPLAY_MAX_MS = 20000;
/** No resolve from the TV this long after a hit notice: buzz anyway. */
export const HAPTIC_FALLBACK_MS = 6000;
/** A TV moment is kept this long for a hit notice that arrives after it. */
export const MOMENT_KEEP_MS = 6000;
/** The buzz on the TV's resolve: short, short, long. */
export const HIT_PATTERN = [80, 60, 80, 60, 160];
/** The buzz at notice time (no TV, or the TV never said it resolved): the pattern hits always had. */
export const HIT_PATTERN_PLAIN = [70, 50, 70];

/** Valid echo targets only, at most 8 (a message from a phone is never trusted as it is). */
export function cleanTargets(raw: unknown): EchoTarget[] {
  if (!Array.isArray(raw)) return [];
  const out: EchoTarget[] = [];
  const COLORS = ['red', 'green', 'blue', 'yellow', 'black', 'purple', 'orange', 'pink', 'bronze'];
  const RES = ['megacredits', 'steel', 'titanium', 'plants', 'energy', 'heat'];
  for (const t of raw) {
    if (!t || typeof t !== 'object') continue;
    const x = t as Record<string, unknown>;
    if (x.kind === 'space' && typeof x.spaceId === 'string' && /^[0-9]{2,3}$/.test(x.spaceId)) out.push({kind: 'space', spaceId: x.spaceId});
    else if (x.kind === 'global' && (x.param === 'temperature' || x.param === 'oxygen' || x.param === 'oceans')) out.push({kind: 'global', param: x.param});
    else if (x.kind === 'res' && COLORS.includes(String(x.color)) && RES.includes(String(x.resource))) out.push({kind: 'res', color: x.color as Color, resource: x.resource as never});
    else if (x.kind === 'tr' && COLORS.includes(String(x.color))) out.push({kind: 'tr', color: x.color as Color});
    if (out.length >= 8) break;
  }
  // the same target twice pulses once
  const seen = new Set<string>();
  return out.filter((t) => { const k = JSON.stringify(t); if (seen.has(k)) return false; seen.add(k); return true; });
}

// ---- replay: one at a time per phone, then a cooldown ---------------------------------------------------------------
export type LimitVerdict = {ok: true} | {ok: false; error: string; retryInMs: number};

export class ReplayDesk {
  /** per player: the replay on its way (id, when asked) and when the last one finished */
  private live = new Map<string, {id: string; at: number}>();
  private doneAt = new Map<string, number>();

  constructor(private cooldownMs = REPLAY_COOLDOWN_MS, private maxMs = REPLAY_MAX_MS) {}

  judge(playerId: string, now: number): LimitVerdict {
    const cur = this.live.get(playerId);
    if (cur && now - cur.at < this.maxMs) return {ok: false, error: 'The TV is still showing your last request', retryInMs: this.maxMs - (now - cur.at)};
    // a replay that never reported back counts as finished when it timed out
    const done = cur ? cur.at + this.maxMs : this.doneAt.get(playerId) ?? -Infinity;
    const wait = done + this.cooldownMs - now;
    if (wait > 0) return {ok: false, error: `Try again in ${Math.ceil(wait / 1000)} s`, retryInMs: wait};
    return {ok: true};
  }

  start(playerId: string, id: string, now: number) {
    this.live.set(playerId, {id, at: now});
  }

  /** The TV finished (or dropped) a replay; the cooldown runs from now. Unknown or repeated ids change nothing. */
  done(id: string, now: number): string | null {
    for (const [playerId, cur] of this.live) {
      if (cur.id !== id) continue;
      this.live.delete(playerId);
      this.doneAt.set(playerId, now);
      return playerId;
    }
    return null;
  }

  /** The replay a player has on its way, if any (for tests and the log). */
  pending(playerId: string): string | null {
    return this.live.get(playerId)?.id ?? null;
  }
}

/** Echoes: at most one per phone every `gapMs`. */
export class EchoLimiter {
  private last = new Map<string, number>();
  constructor(private gapMs = ECHO_GAP_MS) {}
  take(playerId: string, now: number): LimitVerdict {
    const at = this.last.get(playerId);
    if (at !== undefined && now - at < this.gapMs) return {ok: false, error: 'One moment', retryInMs: this.gapMs - (now - at)};
    this.last.set(playerId, now);
    return {ok: true};
  }
}

// ---- haptics: buzz when the TV resolves the hit -------------------------------------------------------------------
/** A seat to buzz now. */
export type Buzz = {seat: string; attacker: Color | null; synced: boolean};

type Pending = {seat: string; color: Color; attacker: Color | null; age: number; at: number};
/** `targets`: colours still owed a buzz by this moment; `answered`: colours it buzzed already */
type Seen = {key: string; attacker: Color; targets: Color[]; answered: Color[]; age: number; at: number};

/**
 * Which phones buzz for a hit, and when. A hit notice (the server's table sense) waits for the TV to reach the hit's
 * resolution (a tvMoment); the target seats buzz then. A seat that is not among the moment's targets never buzzes for
 * it. With no TV connected, or no moment within HAPTIC_FALLBACK_MS, the notice buzzes on its own. A moment that
 * arrives before its notice is kept for a while, and the notice then buzzes at once. Every hit buzzes once.
 */
export class HapticRelay {
  private pending: Pending[] = [];
  private seen: Seen[] = [];
  /** hits that buzzed at the fallback: their moment, coming late, is theirs and must not answer the next hit */
  private fellBack: Pending[] = [];

  constructor(private fallbackMs = HAPTIC_FALLBACK_MS, private keepMs = MOMENT_KEEP_MS) {}

  /** A hit notice for `seat` (its colour `color`), made by `attacker` at engine gameAge `age`. */
  notice(n: {seat: string; color: Color; attacker: Color | null; age: number}, now: number, tvs: number): Buzz[] {
    this.prune(now);
    if (tvs <= 0) return [{seat: n.seat, attacker: n.attacker, synced: false}];
    // the same seat already pending for this attacker and moment: one buzz covers both notices
    if (this.pending.some((p) => p.seat === n.seat && p.attacker === n.attacker && p.age === n.age)) return [];
    const near = (s: Seen) => (n.attacker === null || s.attacker === n.attacker) && Math.abs(s.age - n.age) <= 1;
    // that moment buzzed this colour already: a second notice of the same hit stays quiet
    if (this.seen.some((s) => near(s) && s.age === n.age && s.answered.includes(n.color))) return [];
    const m = this.seen.find((s) => near(s) && s.targets.includes(n.color));
    if (m) {
      // the TV resolved the hit before its notice came: buzz now
      m.targets = m.targets.filter((c) => c !== n.color);
      m.answered.push(n.color);
      return [{seat: n.seat, attacker: n.attacker ?? m.attacker, synced: true}];
    }
    this.pending.push({seat: n.seat, color: n.color, attacker: n.attacker, age: n.age, at: now});
    return [];
  }

  /**
   * A TV reached a hit's resolution. Duplicates (another TV, the same TV twice) are ignored. Returns the pending target
   * seats to buzz; target colours with no notice yet are remembered for a notice that arrives later.
   */
  moment(m: TvMoment, now: number): Buzz[] {
    this.prune(now);
    const key = `${m.gameAge}|${m.attacker}|${[...m.targets].sort().join(',')}`;
    if (this.seen.some((s) => s.key === key)) return [];
    const out: Buzz[] = [];
    const left: Color[] = [];
    const answered: Color[] = [];
    for (const color of new Set(m.targets)) {
      if (color === m.attacker) continue;
      const mine = this.pending.filter((p) => p.color === color && (p.attacker === null || p.attacker === m.attacker) && Math.abs(p.age - m.gameAge) <= 1);
      if (!mine.length) {
        // the hit already buzzed at the fallback: this late moment is its own, not the next hit's
        const late = this.fellBack.findIndex((p) => p.color === color && (p.attacker === null || p.attacker === m.attacker) && Math.abs(p.age - m.gameAge) <= 1);
        if (late >= 0) { this.fellBack.splice(late, 1); answered.push(color); continue; }
        left.push(color);
        continue;
      }
      this.pending = this.pending.filter((p) => !mine.includes(p));
      answered.push(color);
      for (const seat of new Set(mine.map((p) => p.seat))) out.push({seat, attacker: m.attacker, synced: true});
    }
    this.seen.push({key, attacker: m.attacker, targets: left, answered, age: m.gameAge, at: now});
    return out;
  }

  /** Notices whose moment never came: buzz them now. Call every second or so. */
  tick(now: number): Buzz[] {
    const due = this.pending.filter((p) => now - p.at >= this.fallbackMs);
    if (!due.length) { this.prune(now); return []; }
    this.pending = this.pending.filter((p) => !due.includes(p));
    this.fellBack.push(...due.map((p) => ({...p, at: now})));
    this.prune(now);
    return due.map((p) => ({seat: p.seat, attacker: p.attacker, synced: false}));
  }

  /** An undo or a new game: what was waiting belongs to moves that no longer happened. */
  reset() { this.pending = []; this.seen = []; this.fellBack = []; }

  /** Seats waiting for the TV (tests). */
  waiting(): string[] { return this.pending.map((p) => p.seat); }

  private prune(now: number) {
    this.seen = this.seen.filter((s) => now - s.at < this.keepMs);
    this.fellBack = this.fellBack.filter((p) => now - p.at < this.keepMs * 2);
  }
}
