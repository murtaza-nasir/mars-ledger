// The phone's performance recorder. Off by default; turned on per device from the ⋯ game menu or with
// ?perf=1 (?perf=0 turns it off). While on it times every animation frame, pairs the interaction marks the UI sets
// (open, swipe, close, tab, scroll), counts renders of a few components, and uploads the session to /api/perf when
// recording stops, every 60 s, and when asked. Off, nothing runs: no frame loop, no counting, no observers.
import {estimateRefresh, PERF_INTERACTIONS, type PerfComponent, type PerfInteraction, type PerfInteractionName, type PerfSession} from '../../shared/perf';
import {IS_IOS} from '../ui/platform';
import {buildInteraction, DeltaHistogram, FrameRing, MarkBook} from './core';

declare const __BUILD_ID__: string;
export const BUILD_ID = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';

const KEY = 'mars-ledger-perf';
const LABEL_KEY = 'mars-ledger-perf-label';
const UPLOAD_EVERY_MS = 60_000;
const MAX_KEPT = 2000;

export type PerfStatus = {on: boolean; sessionId: string | null; interactions: number; sending: boolean; lastSent: {at: number; ok: boolean; text: string} | null; label: string};

let on = false;
let status: PerfStatus = {on: false, sessionId: null, interactions: 0, sending: false, lastSent: null, label: ''};
const listeners = new Set<() => void>();
function setStatus(patch: Partial<PerfStatus>) { status = {...status, ...patch}; for (const l of listeners) l(); }
export function subscribePerf(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }
export function perfStatus() { return status; }
export const perfOn = () => on;

// ---- session state (only allocated while recording) -----------------------------------------------------------
type Session = {
  id: string; startedAt: number; origin: number; ring: FrameRing; hist: DeltaHistogram; book: MarkBook;
  renders: Record<string, number>; interactions: PerfInteraction[]; longTasks: Array<{s: number; d: number}>;
  last: number | null; raf: number; timer: ReturnType<typeof setInterval> | null; observer: PerformanceObserver | null; dirty: boolean;
};
let s: Session | null = null;
let badge: HTMLElement | null = null;

const longTaskSupported = () => typeof PerformanceObserver !== 'undefined' && (PerformanceObserver.supportedEntryTypes ?? []).includes('longtask');

function newId() {
  const a = new Uint8Array(9);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
}

function intervalMs(x: Session) {
  // the session median once there are enough frames, else the recent ones
  if (x.hist.total >= 120) return estimateRefresh([x.hist.median()]).intervalMs;
  return estimateRefresh(x.ring.recent(240)).intervalMs;
}

const frame = (t: number) => {
  const x = s;
  if (!x) return;
  // a hidden page gets no frames; the gap after it is not a slow frame
  if (x.last !== null && document.visibilityState === 'visible') {
    const d = t - x.last;
    if (d > 0 && d < 1000) { x.ring.push(t, d); x.hist.add(d); }
  }
  x.last = t;
  x.raf = requestAnimationFrame(frame);
};

const onVisibility = () => {
  if (!s) return;
  if (document.visibilityState === 'hidden') { s.last = null; void send('auto', true); } else s.last = null;
};
const onPageHide = () => { if (s) void send('auto', true); };

function begin() {
  if (s) return;
  const origin = performance.now();
  s = {id: newId(), startedAt: Date.now(), origin, ring: new FrameRing(), hist: new DeltaHistogram(), book: new MarkBook(), renders: {},
    interactions: [], longTasks: [], last: null, raf: 0, timer: null, observer: null, dirty: false};
  s.raf = requestAnimationFrame(frame);
  s.timer = setInterval(() => { if (s?.dirty) void send('auto'); }, UPLOAD_EVERY_MS);
  if (longTaskSupported()) {
    const x = s;
    x.observer = new PerformanceObserver((list) => { for (const e of list.getEntries()) x.longTasks.push({s: e.startTime, d: e.duration}); if (x.longTasks.length > 5000) x.longTasks.splice(0, 1000); });
    try { x.observer.observe({type: 'longtask', buffered: false} as PerformanceObserverInit); } catch { x.observer = null; }
  }
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', onPageHide);
  showBadge(true);
  setStatus({on: true, sessionId: s.id, interactions: 0, lastSent: null});
}

async function finish() {
  const x = s;
  if (!x) return;
  await send('auto');
  cancelAnimationFrame(x.raf);
  if (x.timer) clearInterval(x.timer);
  x.observer?.disconnect();
  document.removeEventListener('visibilitychange', onVisibility);
  window.removeEventListener('pagehide', onPageHide);
  s = null;
  showBadge(false);
  setStatus({on: false});
}

function showBadge(show: boolean) {
  if (!show) { badge?.remove(); badge = null; return; }
  if (badge || typeof document === 'undefined') return;
  badge = document.createElement('div');
  badge.setAttribute('data-perf-rec', '');
  badge.setAttribute('aria-hidden', 'true');
  badge.textContent = 'REC';
  // static, small, out of the way: one fixed layer that never repaints
  badge.style.cssText = 'position:fixed;left:2px;top:calc(env(safe-area-inset-top) + 2px);z-index:2147483000;pointer-events:none;'
    + 'display:flex;align-items:center;gap:3px;padding:1px 4px 1px 3px;border-radius:5px;background:rgba(150,20,20,.78);color:#fff;'
    + 'font:700 8px/1.2 system-ui,sans-serif;letter-spacing:.05em;';
  const dot = document.createElement('span');
  dot.style.cssText = 'width:5px;height:5px;border-radius:3px;background:#ff4d4d;';
  badge.prepend(dot);
  document.body.appendChild(badge);
}

// ---- the API the UI calls ---------------------------------------------------------------------------------------

/** Marks the start or end of an interaction. Does nothing unless recording. An end settles two frames later, so the
 *  renders the end itself causes (the next card, the shown tab) and the frame that paints them count. */
export function perfMark(name: PerfInteractionName, phase: 'start' | 'end') {
  const x = s;
  if (!x) return;
  if (phase === 'start') { x.book.start(name, performance.now(), x.renders); return; }
  requestAnimationFrame(() => requestAnimationFrame(() => { if (s === x) settle(x, name); }));
}

function settle(x: Session, name: PerfInteractionName) {
  const t = performance.now();
  const r = x.book.end(name, t, x.renders);
  if (!r) return;
  const tasks = x.observer ? x.longTasks.filter((l) => l.s < t && l.s + l.d > r.start).map((l) => Math.round(l.d)) : null;
  x.interactions.push(buildInteraction(name, r.start, t, x.ring.between(r.start, t), intervalMs(x), r.renders, tasks, x.origin));
  if (x.interactions.length > MAX_KEPT) x.interactions.splice(0, x.interactions.length - MAX_KEPT);
  x.dirty = true;
  setStatus({interactions: x.interactions.length});
}

/** Counts a render of a component while recording; a no-op otherwise. Call it unconditionally in the component body. */
export function useRenderCount(name: PerfComponent) {
  if (s) s.renders[name] = (s.renders[name] ?? 0) + 1;
}

export function sessionSnapshot(): PerfSession | null {
  const x = s;
  if (!x) return null;
  const iv = intervalMs(x);
  return {id: x.id, startedAt: x.startedAt, sentAt: Date.now(), duration: Math.round(performance.now() - x.origin), label: status.label,
    device: {ua: navigator.userAgent, dpr: window.devicePixelRatio || 1, screen: {w: screen.width, h: screen.height},
      viewport: {w: window.innerWidth, h: window.innerHeight}, refreshHz: Math.round(1000 / iv), build: BUILD_ID, ios: IS_IOS,
      standalone: (navigator as Navigator & {standalone?: boolean}).standalone === true || matchMedia('(display-mode: standalone)').matches,
      longTaskSupported: !!x.observer},
    overall: x.hist.stats(iv), interactions: x.interactions};
}

/** Uploads the session so far. `beacon` uses a keepalive request (page going away), which only carries ~60 kB. */
export async function send(why: 'auto' | 'manual', beacon = false): Promise<void> {
  const snap = sessionSnapshot();
  if (!snap) return;
  const body = JSON.stringify(snap);
  if (s) s.dirty = false;
  if (why === 'manual') setStatus({sending: true});
  try {
    const r = await fetch('/api/perf', {method: 'POST', headers: {'content-type': 'application/json'}, body, keepalive: beacon && body.length < 60_000});
    const ok = r.ok;
    setStatus({sending: false, lastSent: {at: Date.now(), ok, text: ok ? `Sent ${snap.interactions.length} interactions (session ${snap.id.slice(0, 6)})` : `Not sent: the server said ${r.status}`}});
  } catch {
    if (s) s.dirty = true;
    setStatus({sending: false, lastSent: {at: Date.now(), ok: false, text: 'Not sent: no connection to the server'}});
  }
}

export function setPerfLabel(label: string) {
  try { localStorage.setItem(LABEL_KEY, label); } catch { /* private mode */ }
  setStatus({label: label.slice(0, 80)});
  if (s) s.dirty = true;
}

/** Turns recording on or off for this device. */
export async function setPerfOn(next: boolean) {
  try { if (next) localStorage.setItem(KEY, '1'); else localStorage.removeItem(KEY); } catch { /* private mode: this visit only */ }
  on = next;
  if (next) begin(); else await finish();
}

/** Called once at phone start-up: ?perf=1 / ?perf=0 first, then the device's saved choice. */
export function initPerf() {
  let want = false;
  try {
    const q = new URLSearchParams(location.search).get('perf');
    if (q === '1') localStorage.setItem(KEY, '1');
    if (q === '0') localStorage.removeItem(KEY);
    want = localStorage.getItem(KEY) === '1' || q === '1';
    setStatus({label: localStorage.getItem(LABEL_KEY) ?? ''});
  } catch {
    want = new URLSearchParams(location.search).get('perf') === '1';
  }
  if (want) { on = true; begin(); }
}

export {PERF_INTERACTIONS};
