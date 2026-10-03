// How long each phase of a move's presentation lasts on the TV. A played card goes through four
// phases: anticipation (the player's chime, their panel pulses), travel (the card flies from their panel to the centre),
// hold (it parks, still, for reading, longer for longer rules text) and resolution (gains fly to the panel, a reticle
// pings the hex, the tile drops). The game itself has already moved on; only the TV's presentation is sequenced.
//
// Adaptive pacing: the full timings when the table is quiet. When moves pile up (moments waiting behind this one, the
// TV running late, bot moves arriving in quick succession) every phase shortens by one factor, down to 40 %; resource
// flights merge into one token per resource and the reticle pings once (or not at all at the floor). Pure, so the
// rules are tested without a browser (tests/tvPipeline.test.ts).

/** Full (quiet) timings, ms. */
export const QUIET = {
  anticipation: 500,
  travelMin: 600, travelMax: 1200,
  holdMin: 1500, holdMax: 2500,
  /** the card steps aside and the board brightens before anything resolves */
  aside: 350,
  /** resource tokens fly to the panel (0.72 s flight plus their stagger) */
  flights: 950,
  /** one reticle ping */
  ping: 380,
  /** after the tile drops: time to see it land before the card leaves */
  drop: 1100,
  exit: 380,
} as const;

/** The pacing factor never goes below this share of the full timings. */
export const FLOOR = 0.4;
/** Moves arriving closer together than this count as a burst (bots, quick successive moves). */
export const BURST_GAP_MS = 2500;
/** A moment that starts this late (ms after its update arrived) is already behind: lag beyond it shortens the phases. */
export const LAG_FREE_MS = 1500;
/** A played card still waiting this long after its update is skipped: its tile and gains show at once. */
export const CARD_STALE_MS = 12000;
/** Behind by more than this with more moments waiting: the moment at the head is skipped (it resolves at once), so
 *  the TV never runs more than a few seconds behind the game. */
export const BEHIND_MAX_MS = 6000;

export type PaceInput = {
  /** moments queued behind this one */
  waiting: number;
  /** ms between this moment's update arriving and the moment starting */
  lagMs: number;
  /** ms between the previous moment's update and this one's (null: none before) */
  sinceLastMs: number | null;
};

/** One factor for every phase of a moment: 1 when quiet, down to FLOOR when moves pile up. */
export function paceFactor(p: PaceInput): number {
  const byQueue = 1 - 0.25 * Math.max(0, p.waiting);
  const byLag = 1 - 0.25 * Math.max(0, (p.lagMs - LAG_FREE_MS) / 1000);
  const byBurst = p.sinceLastMs !== null && p.sinceLastMs < BURST_GAP_MS ? 0.75 : 1;
  const f = Math.min(byQueue, byLag, byBurst);
  return Math.round(Math.max(FLOOR, Math.min(1, f)) * 100) / 100;
}

/** Skip the moment at the head: too far behind with more waiting, or very late. Replays are never skipped. */
export function skipBehind(p: Pick<PaceInput, 'waiting' | 'lagMs'>): boolean {
  return (p.waiting > 0 && p.lagMs > BEHIND_MAX_MS) || p.lagMs > CARD_STALE_MS;
}

/** Busy pacing: flights merge and the reticle pings once. */
export const isBusy = (factor: number) => factor < 0.9;

/** The quiet hold for a card's rules text: 1.5 s for a line or two, up to 2.5 s for a long card. */
export function holdForText(chars: number): number {
  const k = Math.max(0, Math.min(1, (chars - 40) / 220));
  return Math.round(QUIET.holdMin + k * (QUIET.holdMax - QUIET.holdMin));
}

/** The quiet travel time for a flight across `distance` (0..1 of the screen's diagonal). */
export function travelFor(distance: number): number {
  const k = Math.max(0, Math.min(1, distance / 0.6));
  return Math.round(QUIET.travelMin + k * (QUIET.travelMax - QUIET.travelMin));
}

export type CardShape = {
  /** characters of the card's rules text */
  textLen: number;
  /** panel-to-centre distance as a share of the screen diagonal */
  distance: number;
  /** resources fly to the panel */
  gains: boolean;
  /** a tile waits to drop */
  tile: boolean;
  /** no travel, trails, flights or pings (prefers-reduced-motion) */
  reduced: boolean;
  /** a replay: Phase 3 and 4 only */
  replay?: boolean;
};

/** Start times (ms from the moment's start) and lengths of each phase. */
export type CardPlan = {
  factor: number; busy: boolean;
  anticipation: number; travel: number; hold: number;
  /** when the card parks (hold starts), when it steps aside (resolution starts) */
  holdAt: number; resolveAt: number;
  /** flights: start and length (0: none); merged into one token per resource when busy */
  flightsAt: number; flights: number; mergeFlights: boolean;
  /** reticle: start, number of pings (0: none) and the length of one */
  reticleAt: number; pings: number; ping: number;
  /** the tile drops (the existing camera dive and build-in) */
  dropAt: number;
  exitAt: number; total: number;
};

export function planCard(shape: CardShape, pace: PaceInput): CardPlan {
  const factor = paceFactor(pace);
  const busy = isBusy(factor);
  const f = (ms: number) => Math.round(ms * factor);
  const anticipation = shape.replay ? 0 : f(QUIET.anticipation);
  const travel = shape.replay ? 0 : shape.reduced ? f(300) : f(travelFor(shape.distance));
  const hold = f(holdForText(shape.textLen));
  const holdAt = anticipation + travel;
  const resolveAt = holdAt + hold;
  const aside = f(QUIET.aside);
  const flightsAt = resolveAt + aside;
  const flies = shape.gains && !shape.reduced;
  // the tokens' own flight is 0.72 s; busy, they leave together so only the stagger shrinks with the factor
  const flights = flies ? Math.max(f(QUIET.flights), busy ? 760 : 0) : 0;
  const pings = !shape.tile || shape.reduced ? 0 : !busy ? 2 : factor > 0.5 ? 1 : 0;
  const ping = Math.max(240, f(QUIET.ping));
  const reticleAt = flightsAt + flights;
  const dropAt = shape.tile ? reticleAt + pings * ping : reticleAt;
  const exitAt = dropAt + (shape.tile ? f(QUIET.drop) : f(400));
  const total = exitAt + f(QUIET.exit);
  return {factor, busy, anticipation, travel, hold, holdAt, resolveAt, flightsAt, flights, mergeFlights: busy, reticleAt, pings, ping, dropAt, exitAt, total};
}

/** A card action's moment, paced the same way: 2.6 s quiet, never under 1.2 s. */
export function actionMs(pace: PaceInput): number {
  return Math.max(1200, Math.round(2600 * paceFactor(pace)));
}

/** An attack's moment: 3.4 s quiet, never under 2 s (the targets' names must be readable). */
export function attackMs(pace: PaceInput): number {
  return Math.max(2000, Math.round(3400 * paceFactor(pace)));
}

/** How long a card's panel and tile holds may last before they let go anyway (ms from the update). */
export function holdDeadline(plan: Pick<CardPlan, 'dropAt' | 'flightsAt' | 'flights'>, aheadMs: number): number {
  return Math.min(CARD_STALE_MS + 2000, aheadMs + Math.max(plan.dropAt, plan.flightsAt + plan.flights) + 2500);
}
