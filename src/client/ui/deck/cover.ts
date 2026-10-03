// Whether the lifted card view fully covers the page. While it does, the page underneath stops its clocks and
// rotating hints, and on iPhones it is not painted at all (styles.css), so nothing behind the view repaints while
// cards slide in front of it.
import {useSyncExternalStore} from 'react';

let covered = false;
const subs = new Set<() => void>();

export function setViewerCovered(v: boolean) {
  if (covered === v) return;
  covered = v;
  if (typeof document !== 'undefined') document.body.classList.toggle('tm-viewer-covered', v);
  for (const f of subs) f();
}

const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

export function useViewerCovered(): boolean {
  return useSyncExternalStore(subscribe, () => covered, () => false);
}
