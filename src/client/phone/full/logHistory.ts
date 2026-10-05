// The Log tab's history: every view brings the engine's newest 50 lines, and this keeps what the phone has seen
// since it loaded (up to HISTORY_MAX lines), so older moves stay in the log instead of dropping off its end and rows
// do not vanish from under a reader. Fed from the store from the moment the module loads, whatever tab is open.
import {useSyncExternalStore} from 'react';
import type {FullView, LogLine} from '../../../shared/full';
import {useNet} from '../../net';
import {lineKey, mergeLog} from './logMoves';
import {vpSnapshot} from './logVp';
import type {VpAt} from './logVp';

/** `window`: the view's own lines this history last took in */
let history: {playerId: string | null; window: LogLine[] | null; lines: LogLine[]; vp: number} = {playerId: null, window: null, lines: [], vp: 0};
/** Everyone's VP as of each view, by the key of the last log line that view had (see logVp.ts). Kept in place; `vp` counts the changes. */
const snaps = new Map<string, VpAt>();
const SNAPS_MAX = 1500;
let lastWindow: LogLine[] | undefined;
const listeners = new Set<() => void>();

function feed(view: FullView | null) {
  if (!view || view.role !== 'player' || !view.logs || view.logs === lastWindow) return;
  lastWindow = view.logs;
  const lines = history.playerId === view.playerId ? mergeLog(history.lines, view.logs) : view.logs.slice();
  if (history.playerId !== view.playerId) snaps.clear();
  const at = view.logs[view.logs.length - 1];
  const vp = vpSnapshot(view.model);
  if (at && vp) {
    const key = lineKey(at);
    snaps.delete(key);
    snaps.set(key, vp);
    if (snaps.size > SNAPS_MAX) for (const k of snaps.keys()) { snaps.delete(k); if (snaps.size <= SNAPS_MAX) break; }
  }
  history = {playerId: view.playerId, window: view.logs, lines, vp: history.vp + 1};
  for (const f of listeners) f();
}
feed(useNet.getState().fullView);
useNet.subscribe((s) => feed(s.fullView));

const subscribe = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };
const snapshot = () => history;

/** The log so far (oldest first) for the view whose window is `logs`; `logs` itself until the history has taken it in. */
export function useLogHistory(logs: LogLine[]): LogLine[] {
  const h = useSyncExternalStore(subscribe, snapshot, snapshot);
  return h.window === logs ? h.lines : logs;
}

/** The VP snapshots (see logVp.ts) and a counter that changes whenever one is added. */
export function useVpSnaps(): {snaps: Map<string, VpAt>; version: number} {
  const h = useSyncExternalStore(subscribe, snapshot, snapshot);
  return {snaps, version: h.vp};
}
