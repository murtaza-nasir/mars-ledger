// The TV's move pipeline (pacing.ts) as shared state: tiles waiting to drop, the reticle on the 3D board, the panel
// pulse of Phase 1, played cards the log ticker waits for, and replays asked for by other layers. The game state is
// never changed here: holds only delay what the TV shows, and every hold has a deadline.
import {create} from 'zustand';
import type {Color} from '../../../../shared/full';
import type {Flight} from '../actions';

/**
 * A move to show again (Phase 3 and 4 visuals only): the card parks in the centre and holds, then its gains fly to
 * the player's panel and the reticle pings its hex. No state change, no panel holds, no chime and no tvMoment.
 */
export type ReplayMoment = {
  /** who made the move */
  color: Color;
  /** the card played or used (none: the reticle alone, when `spaceId` is set) */
  card?: string;
  /** the verb under the player's name; default 'played' */
  verb?: string;
  /** resources that fly from the card to the panel (visual only) */
  gains?: Flight[];
  /** a hex to ping with the reticle (the tile is already on the board) */
  spaceId?: string;
  /** called once when the replay has played, or was dropped (an undo, another game) */
  onDone?: () => void;
};

export type Reticle = {seq: number; spaceId: string; color: string; at: number; pings: number; ping: number};
export type TileHold = {spaceId: string; tileType: number; moment: string; until: number};
export type QueuedReplay = ReplayMoment & {k: string; at: number};

type Pipeline = {
  replays: QueuedReplay[];
  reticle: Reticle | null;
  pulse: {color: string; at: number; ms: number} | null;
  /** a card is parked in the centre: the board behind it darkens */
  dim: boolean;
  /** new tiles the board shows only when their card's drop phase comes */
  tiles: TileHold[];
  /** played cards ('color|name') not yet resolved: the log ticker keeps their move back until then */
  waiting: Array<{key: string; until: number}>;
  /** bumps on clearPipeline: tiles gone with it were undone, not dropped */
  epoch: number;
};

export const usePipeline = create<Pipeline>(() => ({replays: [], reticle: null, pulse: null, dim: false, tiles: [], waiting: [], epoch: 0}));

let seq = 0;
/** At most this many replays wait at once; older asks are dropped. */
const MAX_REPLAYS = 3;

/**
 * Show a move again on this TV (Phase 3 and 4 visuals only). Queued after the moments already waiting; it stays in
 * `replays` until it starts showing. Returns its key.
 */
export function replayMoment(m: ReplayMoment): string {
  const k = `replay-${Date.now().toString(36)}-${++seq}`;
  usePipeline.setState((s) => ({replays: [...s.replays, {...m, k, at: Date.now()}].slice(-MAX_REPLAYS)}));
  return k;
}

/** A replay starts showing (or is dropped): it leaves the waiting list. */
export function replayStarted(k: string) {
  usePipeline.setState((s) => (s.replays.some((r) => r.k === k) ? {replays: s.replays.filter((r) => r.k !== k)} : s));
}

export function pingHex(spaceId: string, color: string, pings: number, ping: number) {
  usePipeline.setState({reticle: {seq: ++seq, spaceId, color, at: performance.now(), pings, ping}});
}

export function pulsePanel(color: string, ms: number) {
  usePipeline.setState({pulse: {color, at: Date.now(), ms}});
}

const timers = new Map<string, ReturnType<typeof setTimeout>>();

/** Hold new tiles back until `until` (Date.now() ms) at the latest. */
export function holdTiles(moment: string, tiles: Array<{spaceId: string; tileType: number}>, until: number) {
  if (!tiles.length) return;
  const ids = tiles.map((t) => t.spaceId);
  usePipeline.setState((s) => ({tiles: [...s.tiles.filter((t) => !ids.includes(t.spaceId)), ...tiles.map((t) => ({...t, moment, until}))]}));
  const key = `${moment}|${ids.join(',')}`;
  clearTimeout(timers.get(key));
  timers.set(key, setTimeout(() => { timers.delete(key); releaseTiles((t) => t.moment === moment); }, Math.max(0, until - Date.now()) + 20));
}

/** Let tiles drop now (their phase came, the moment was skipped, or the deadline passed). Returns the tiles let go. */
export function releaseTiles(pred: (t: TileHold) => boolean): TileHold[] {
  const out = usePipeline.getState().tiles.filter(pred);
  if (out.length) usePipeline.setState((s) => ({tiles: s.tiles.filter((t) => !pred(t))}));
  return out;
}

export const setDim = (dim: boolean) => { if (usePipeline.getState().dim !== dim) usePipeline.setState({dim}); };

/** An undo or another game: nothing waits any more, and nothing drops (the tiles are gone or belong elsewhere). */
export function clearPipeline() {
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
  usePipeline.setState((s) => ({tiles: [], waiting: [], reticle: null, pulse: null, dim: false, epoch: s.epoch + 1}));
}

export const cardKey = (color: string, name: string) => `${color}|${name}`;

export function markWaiting(keys: string[], until: number) {
  if (!keys.length) return;
  usePipeline.setState((s) => ({waiting: [...s.waiting.filter((w) => w.until > Date.now() && !keys.includes(w.key)), ...keys.map((key) => ({key, until}))]}));
}

export function doneWaiting(key: string) {
  usePipeline.setState((s) => (s.waiting.some((w) => w.key === key) ? {waiting: s.waiting.filter((w) => w.key !== key)} : s));
}

// Test hook: replay a move from the console or a script (window.__replayMoment({color: 'red', card: 'Asteroid'})).
if (typeof window !== 'undefined') (window as unknown as {__replayMoment?: typeof replayMoment}).__replayMoment = replayMoment;
