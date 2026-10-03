// The TV's cinematics play one at a time: corporation reveals, generation recaps, terraforming
// milestones, the end-of-game story. Each has a stable id and plays once per TV, even across a reload.
import {create} from 'zustand';
import type {Color} from '../../../shared/full';
import type {GameHistory} from '../../../shared/history';

export type RevealSeat = {color: Color; name: string; corporation: string; megacredits: number; production: Record<string, number>;
  /** the two preludes this founder starts with (Prelude games) */
  preludes?: string[]};

/** Seconds one founder holds the reveal: longer when their preludes sweep in too. */
export const seatSeconds = (s: RevealSeat) => (s.preludes?.length ? 3.8 : 2.6);
export type MilestoneKind = 'temperature' | 'oxygen' | 'oceans' | 'all' | 'heat-bonus' | 'ocean-bonus' | 'oxygen-bonus';

export type Cinematic =
  | {id: string; kind: 'reveal'; seats: RevealSeat[]}
  | {id: string; kind: 'recap'; generation: number; notBefore: number}
  | {id: string; kind: 'milestone'; milestone: MilestoneKind; by?: {name: string; color: Color}; value: number;
      planet: {from: {sea: number; green: number; warmth: number}; to: {sea: number; green: number; warmth: number}}}
  | {id: string; kind: 'story'};

/** Seconds each cinematic holds the screen (the story holds until the next game). */
export function durationOf(c: Cinematic): number {
  switch (c.kind) {
  case 'reveal': return 0.8 + c.seats.reduce((a, s) => a + seatSeconds(s), 0);
  case 'recap': return 8.6;
  case 'milestone': return c.milestone.endsWith('bonus') ? 2.8 : c.milestone === 'all' ? 6.2 : 5;
  case 'story': return Infinity;
  }
}

const SEEN_KEY = 'mars-ledger-cinema-seen';
function loadSeen(): string[] {
  try { return JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]') as string[]; } catch { return []; }
}
function remember(id: string) {
  try {
    const list = [...loadSeen().filter((x) => x !== id), id].slice(-300);
    localStorage.setItem(SEEN_KEY, JSON.stringify(list));
  } catch { /* storage off: replays are harmless */ }
}

type Cinema = {
  queue: Cinematic[];
  current: (Cinematic & {startedAt: number}) | null;
  enqueue: (c: Cinematic) => void;
  /** start the next cinematic if nothing is playing and the screen is free */
  pump: (blocked: boolean) => void;
  done: (id: string) => void;
  skip: () => void;
  reset: () => void;
};

const seen = new Set(loadSeen());

export const useCinema = create<Cinema>((set, get) => ({
  queue: [],
  current: null,
  enqueue: (c) => {
    if (seen.has(c.id) || get().queue.some((x) => x.id === c.id) || get().current?.id === c.id) return;
    // Small beats never jump ahead; the big ones keep their order.
    set((s) => ({queue: [...s.queue, c]}));
  },
  pump: (blocked) => {
    const s = get();
    if (s.current || blocked || !s.queue.length) return;
    const now = Date.now();
    // Only the newest recap is worth showing; older ones are stale by the time the screen frees up.
    const newest = Math.max(-1, ...s.queue.filter((c) => c.kind === 'recap').map((c) => (c.kind === 'recap' ? c.generation : -1)));
    const stale = s.queue.filter((c) => c.kind === 'recap' && c.generation < newest);
    if (stale.length) { stale.forEach((c) => seen.add(c.id)); set({queue: s.queue.filter((c) => !stale.includes(c))}); return get().pump(blocked); }
    const i = s.queue.findIndex((c) => c.kind !== 'recap' || c.notBefore <= now);
    if (i < 0) return;
    const next = s.queue[i];
    seen.add(next.id);
    remember(next.id);
    set({current: {...next, startedAt: now}, queue: s.queue.filter((_, k) => k !== i)});
  },
  done: (id) => { if (get().current?.id === id) set({current: null}); },
  skip: () => {
    const c = get().current;
    if (c && c.kind !== 'story') set({current: null});
  },
  reset: () => set({queue: [], current: null}),
}));

export function wasSeen(id: string): boolean { return seen.has(id); }
export function markSeen(id: string) { seen.add(id); remember(id); }

/** Is a history ready to recap this generation? */
export function hasGeneration(h: GameHistory | null, generation: number): boolean {
  return !!h?.generations.some((g) => g.generation === generation && g.closed);
}

// Debug handle for tests and the console (like window.__net).
(window as unknown as {__cinema: typeof useCinema}).__cinema = useCinema;

// Debug handle (like window.__net): the cinema queue, for tests and the console.
(globalThis as unknown as {__cinema?: typeof useCinema}).__cinema = useCinema;
