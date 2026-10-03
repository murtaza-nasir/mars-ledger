// When this TV could not keep the 3D board at 60 fps, it falls back to the flat board for the session (and
// remembers it on this screen). Turning "3D board" back on in the TV options clears it.
import {useSyncExternalStore} from 'react';

const KEY = 'mars-ledger-board3d-fallback';
const WHY = 'mars-ledger-board3d-fallback-why';

/** Why this screen last dropped to the flat board: when, and what was measured (or the error), for TV options. */
export type FallbackReason = {at: number; kind: 'slow'; p95: number; median: number; gaps: number; size: string} | {at: number; kind: 'error'; message: string};

export function fallbackReason(): FallbackReason | null {
  try { const v = localStorage.getItem(WHY); return v ? JSON.parse(v) as FallbackReason : null; } catch { return null; }
}
let fell = (() => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } })();
const listeners = new Set<() => void>();
const emit = () => { for (const l of listeners) l(); };

export function boardFellBack(): boolean { return fell; }

export function markBoardFallback(why?: FallbackReason) {
  fell = true;
  if (why) {
    try { localStorage.setItem(WHY, JSON.stringify(why)); } catch { /* storage blocked */ }
    console.warn('[board3d] switched to the flat board', why);
  }
  try { localStorage.setItem(KEY, '1'); } catch { /* storage blocked: this session only */ }
  emit();
}

export function clearBoardFallback() {
  fell = false;
  try { localStorage.removeItem(KEY); } catch { /* storage blocked */ }
  emit();
}

export function useBoardFallback(): boolean {
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => fell);
}
