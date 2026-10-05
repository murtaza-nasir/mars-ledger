// How much the 3D board draws on this screen: a ladder of levels it steps down when frames stay slow, one level at a
// time, and back up when there is room for a sustained while. The last level is the flat board. Pure ladder logic
// (ladderStep) plus a small store; the level is remembered on this screen, the flat board through fallback.ts.
// No three.js in here: the weather overlay and the TV options read it too.
import {useSyncExternalStore} from 'react';
import {p95} from './camera3d';
import {TV3D_LEVELS} from '../../../../shared/tv3d';
import type {LevelId} from '../../../../shared/tv3d';

export type {LevelId};

/** One rung. Each level keeps every saving of the levels above it. */
export type Level = {
  id: LevelId;
  /** the canvas's resolution against the board's own pixel budget (1 = full) */
  scale: number;
  /** depth of field, the fog and mist planes, light shafts, the full shadow map and the full storm */
  effects: boolean;
  /** board life's characters, their vignettes and reactions */
  terraformers: boolean;
  /** the rest of board life: things from the sky and the ambient rover, drone, dust devils, lichen */
  life: boolean;
  /** every tile at its lite level of detail */
  lite: boolean;
  /** the flat board */
  flat: boolean;
  /** for the TV options and the server log */
  label: string;
};

// scale, effects, terraformers, life, lite, flat per level (ids and labels: shared/tv3d.ts)
const RUNGS: Array<[number, boolean, boolean, boolean, boolean, boolean]> = [
  [1, true, true, true, false, false],
  [0.85, true, true, true, false, false],
  [0.7, true, true, true, false, false],
  [0.7, false, true, true, false, false],
  [0.7, false, false, true, false, false],
  [0.7, false, false, false, false, false],
  [0.7, false, false, false, true, false],
  [0.7, false, false, false, true, true],
];
export const LEVELS: readonly Level[] = TV3D_LEVELS.map(({id, label}, i) => {
  const [scale, effects, terraformers, life, lite, flat] = RUNGS[i];
  return {id, label, scale, effects, terraformers, life, lite, flat};
});
export const FLAT = LEVELS.length - 1;

/**
 * The ladder's timing. Frames are judged in windows of `windowMs`; a window counts as slow when its 95th percentile
 * is over `budgetP95`, and as roomy when its p95 is at most `upP95` with at most `upSlowShare` of frames over
 * `slowFrameMs`. Stepping down needs `firstDown` slow windows in a row from full quality (15 s sustained: a spike
 * never does it), then `nextDown` per further level. The first window after any change is not judged (`settle`: the
 * canvas resizes, shaders compile). Stepping up needs `upWindows` roomy windows in a row (60 s); when a step up is
 * followed by a step down within `probation` windows, the wait before the next step up doubles (up to `upMax`).
 * With vsync, a 60 Hz screen shows 16.7 ms frames however much room is left, so roomy means "every frame on time".
 */
export const LADDER = {windowMs: 5000, budgetP95: 21, firstDown: 3, nextDown: 2, settle: 1, upP95: 17.5, upSlowShare: 0.02, slowFrameMs: 25,
  upWindows: 12, upMax: 96, probation: 12, warmupMs: 10000, minFrames: 20, gapMs: 90};
export type LadderConfig = typeof LADDER;

/** What one judged window measured (ms), the share of frames over slowFrameMs and of gaps over gapMs. */
export type WindowStats = {p95: number; median: number; slow: number; gaps: number; frames: number};

export function windowStats(samples: number[], cfg: Pick<LadderConfig, 'slowFrameMs' | 'gapMs'> = LADDER): WindowStats {
  const s = [...samples].sort((a, b) => a - b);
  const n = s.length;
  return {p95: p95(s), median: n ? s[Math.floor(n / 2)] : 0, slow: n ? s.filter((x) => x > cfg.slowFrameMs).length / n : 0,
    gaps: n ? s.filter((x) => x >= cfg.gapMs).length / n : 0, frames: n};
}

export type LadderState = {
  level: number;
  /** slow and roomy windows in a row */
  bad: number; good: number;
  /** windows still to skip after a change */
  settle: number;
  /** roomy windows a step up needs now */
  upNeed: number;
  /** windows left in which a step down counts against the last step up */
  probation: number;
};

export function ladderStart(level = 0, cfg: LadderConfig = LADDER): LadderState {
  return {level: Math.max(0, Math.min(FLAT, level)), bad: 0, good: 0, settle: 0, upNeed: cfg.upWindows, probation: 0};
}

export type LadderChange = {from: number; to: number; dir: 'down' | 'up'};

/** The next level in a direction that changes something on this screen (`applicable`), or null. Flat always applies. */
export function nextLevel(level: number, dir: 1 | -1, applicable: (i: number) => boolean = () => true): number | null {
  for (let i = level + dir; i >= 0 && i <= FLAT; i += dir) if (i === 0 || i === FLAT || applicable(i)) return i;
  return null;
}

/**
 * Judge one window of frame times (ms). Windows during the warm-up, with too few frames, or in which the page did not
 * have focus are skipped and change nothing: a desktop may slow down the frames of a window nobody is using, which says
 * nothing about the board. Returns the new state, the change to make (if any) and what the window measured.
 */
export function ladderStep(st: LadderState, samples: number[], o: {sinceStartMs: number; focused?: boolean; applicable?: (i: number) => boolean; cfg?: LadderConfig}):
  {state: LadderState; change: LadderChange | null; stats?: WindowStats} {
  const cfg = o.cfg ?? LADDER;
  if (o.sinceStartMs < cfg.warmupMs || samples.length < cfg.minFrames || o.focused === false) return {state: st, change: null};
  const stats = windowStats(samples, cfg);
  if (st.settle > 0) return {state: {...st, settle: st.settle - 1}, change: null, stats};
  const probation = Math.max(0, st.probation - 1);
  if (stats.p95 > cfg.budgetP95) {
    const bad = st.bad + 1;
    const to = bad >= (st.level === 0 ? cfg.firstDown : cfg.nextDown) ? nextLevel(st.level, 1, o.applicable) : null;
    if (to === null) return {state: {...st, bad, good: 0, probation}, change: null, stats};
    // a step up that did not hold: wait longer before the next one
    const upNeed = st.probation > 0 ? Math.min(cfg.upMax, st.upNeed * 2) : st.upNeed;
    return {state: {level: to, bad: 0, good: 0, settle: cfg.settle, upNeed, probation: 0}, change: {from: st.level, to, dir: 'down'}, stats};
  }
  if (stats.p95 <= cfg.upP95 && stats.slow <= cfg.upSlowShare) {
    const good = st.good + 1;
    // a step up that held through its probation lets the next one come a little sooner again
    const upNeed = st.probation === 1 ? Math.max(cfg.upWindows, Math.round(st.upNeed / 2)) : st.upNeed;
    const to = st.level > 0 && st.level < FLAT && good >= upNeed ? nextLevel(st.level, -1, o.applicable) : null;
    if (to === null) return {state: {...st, bad: 0, good, upNeed, probation}, change: null, stats};
    return {state: {level: to, bad: 0, good: 0, settle: cfg.settle, upNeed, probation: cfg.probation}, change: {from: st.level, to, dir: 'up'}, stats};
  }
  return {state: {...st, bad: 0, good: 0, probation}, change: null, stats};
}

/** Which levels change anything on this screen, given its own choices: no point pausing terraformers that are off. */
export function applicableFor(s: {boardLife: boolean; terraformers: boolean; detailed: boolean}): (i: number) => boolean {
  return (i) => {
    const id = LEVELS[i]?.id;
    if (id === 'noTerraformers') return s.boardLife && s.terraformers;
    if (id === 'noLife') return s.boardLife;
    if (id === 'lite') return s.detailed;
    return true;
  };
}

/** The most pixels the 3D canvas draws (it covers the whole screen): 4K. */
export const PIXEL_CAP = 3840 * 2160;
/**
 * The canvas's pixel ratio: the screen's density, at most 2 and at most what keeps the canvas within PIXEL_CAP, times the
 * level's scale. A TV that lays its page out small at a high density (1536×729 at 2.5×) is drawn at up to 2×.
 */
export function renderDpr(vw: number, vh: number, dpr: number, scale = 1, cap = PIXEL_CAP): number {
  const d = Math.min(2, dpr || 1, vw > 0 && vh > 0 ? Math.sqrt(cap / (vw * vh)) : 2);
  return Math.round(d * scale * 1000) / 1000;
}

// ---- the store: this screen's level --------------------------------------------------------------------------------
const KEY = 'mars-ledger-board3d-level';
const WHY = 'mars-ledger-board3d-level-why';

/** Why the level last changed: when, which way, and what the window measured. */
export type LevelReason = {at: number; dir: 'down' | 'up'; from: number; to: number; p95: number; median: number; slow: number; size: string};

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
function storage(): Store | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

function readLevel(s: Store | null): number {
  try {
    const v = Number(s?.getItem(KEY));
    return Number.isInteger(v) && v > 0 && v < FLAT ? v : 0;
  } catch { return 0; }
}
function readWhy(s: Store | null): LevelReason | null {
  try { const v = s?.getItem(WHY); return v ? JSON.parse(v) as LevelReason : null; } catch { return null; }
}

let state: LadderState = ladderStart(readLevel(storage()));
let reason: LevelReason | null = readWhy(storage());
let snapshot = {level: state.level, reason};
const listeners = new Set<() => void>();
const emit = () => { snapshot = {level: state.level, reason}; for (const l of listeners) l(); };

/** The ladder's state for this session (it outlives the 3D board's mounts, so a remount keeps the back-off). */
export function ladderState(): LadderState { return state; }

/** Apply a judged window's new state; a change of level is stored on this screen (the flat level is not: fallback.ts keeps that). */
export function commitLadder(next: LadderState, why?: LevelReason, s: Store | null = storage()) {
  const changed = next.level !== state.level;
  state = next;
  if (!changed) return;
  if (why) reason = why;
  try {
    if (next.level > 0 && next.level < FLAT) s?.setItem(KEY, String(next.level)); else if (next.level === 0) s?.removeItem(KEY);
    if (why) s?.setItem(WHY, JSON.stringify(why));
  } catch { /* storage blocked: this session only */ }
  emit();
}

/** Back to full quality (the TV options' Reset): forgets the level, the reason and the back-off. */
export function resetLadder(s: Store | null = storage()) {
  state = ladderStart(0);
  reason = null;
  try { s?.removeItem(KEY); s?.removeItem(WHY); } catch { /* storage blocked */ }
  emit();
}

/** After the flat board is switched back on, the 3D board resumes one level above flat at most. */
export function resumeFromFlat() {
  if (state.level >= FLAT) { state = {...ladderStart(FLAT - 1), upNeed: state.upNeed}; emit(); }
}

export function useQuality(): {level: number; reason: LevelReason | null} {
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => snapshot);
}

/** The level for code outside React (the storm overlay reads it when a storm starts). */
export function qualityLevel(): Level { return LEVELS[state.level]; }
