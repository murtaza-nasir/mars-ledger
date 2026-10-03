// The Log tab's history: every view brings the engine's newest 50 lines, and this keeps what the phone has seen
// since it loaded (up to HISTORY_MAX lines), so older moves stay in the log instead of dropping off its end and rows
// do not vanish from under a reader. Fed from the store from the moment the module loads, whatever tab is open.
import {useSyncExternalStore} from 'react';
import type {FullView, LogLine} from '../../../shared/full';
import {useNet} from '../../net';
import {mergeLog} from './logMoves';

/** `window`: the view's own lines this history last took in */
let history: {playerId: string | null; window: LogLine[] | null; lines: LogLine[]} = {playerId: null, window: null, lines: []};
let lastWindow: LogLine[] | undefined;
const listeners = new Set<() => void>();

function feed(view: FullView | null) {
  if (!view || view.role !== 'player' || !view.logs || view.logs === lastWindow) return;
  lastWindow = view.logs;
  const lines = history.playerId === view.playerId ? mergeLog(history.lines, view.logs) : view.logs.slice();
  history = {playerId: view.playerId, window: view.logs, lines};
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
