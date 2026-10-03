// How far the TV's player panels fold (Players.tsx `Fold`), measured from the side column.
//
// Raising: whenever the column overflows, the fold goes up one level (React re-renders before paint, so the steps
// never show). At the last level, a column that still overflows shrinks the milestones/awards block to fit (`zoom`).
// Lowering: a fold raised by a passing overflow (a late font, a portrait loading) must not stick for the whole game.
// The column is re-evaluated once things settle (after the fonts load, 1.5 s after a reset, when `settleKey`
// changes, and every 8 s): if the free space could hold the less-folded layout (how much taller each level is was
// measured on the way up) plus a margin, the fold drops to 0 and climbs again to the first level that fits.
// Hysteresis: a lower level is kept only if it leaves at least UNFOLD_MARGIN_VH free, so a column at the edge does
// not flap.
import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import type {Fold} from './Players';

export const MAX_FOLD: Fold = 4;
/** free space (in vh) a lower fold must leave before the panels unfold to it */
export const UNFOLD_MARGIN_VH = 1.2;
/** the milestones/awards block never shrinks below this */
const MIN_ZOOM = 0.62;

/** The column's free height: its own height less its in-flow children and the gaps between them (moments float).
 *  Layout sizes (offsetHeight), not the column's scrollHeight: the odometers' hidden digit stacks in the last panel
 *  reach below the column (up to ~40 px at 1536x729) and a panel's layout animation or attack shake moves it by a
 *  transform; both counted as overflow before and raised the fold a level too far, for good. */
export function columnFree(el: HTMLElement): number {
  const kids = [...el.children].filter((c) => getComputedStyle(c).position !== 'absolute') as HTMLElement[];
  const gap = parseFloat(getComputedStyle(el).rowGap) || 0;
  const used = kids.reduce((a, k) => a + k.offsetHeight, 0) + gap * Math.max(0, kids.length - 1);
  return el.clientHeight - used;
}

type Log = Array<{t: number; fold: number; why: string; free: number}>;

export function useFold(column: React.RefObject<HTMLElement | null>, resetKey: string, settleKey: string): {fold: Fold; zoom: number} {
  const [fold, setFold] = useState<Fold>(0);
  const [zoom, setZoom] = useState(1);
  const foldRef = useRef(fold);
  foldRef.current = fold;
  // a re-evaluation: the fold on screen when it started, and whether the climb from 0 has begun (null when none runs)
  const probe = useRef<{from: Fold; climbing: boolean} | null>(null);
  // grow[f]: how much taller the column content is at fold f - 1 than at fold f (measured on each step up)
  const grow = useRef<Partial<Record<Fold, number>>>({});
  const stepFrom = useRef<{fold: Fold; content: number} | null>(null);
  const [tick, setTick] = useState(0);
  const margin = () => (window.innerHeight * UNFOLD_MARGIN_VH) / 100;
  const log = (why: string, f: number) => {
    const w = window as unknown as {__panelFoldLog?: Log};
    const el = column.current;
    (w.__panelFoldLog ??= []).push({t: Math.round(performance.now()), fold: f, why, free: el ? Math.round(columnFree(el)) : 0});
    if (w.__panelFoldLog.length > 60) w.__panelFoldLog.shift();
  };

  useLayoutEffect(() => {
    probe.current = null; stepFrom.current = null; grow.current = {};
    setFold(0); setZoom(1); log('reset', 0);
  }, [resetKey]);

  useEffect(() => {
    let live = true;
    const again = () => { if (live) setTick((t) => t + 1); };
    const timer = setTimeout(again, 1500);
    // and every few seconds: cheap unless the free space could hold a less-folded layout
    const every = setInterval(again, 8000);
    document.fonts?.ready.then(again, () => {});
    return () => { live = false; clearTimeout(timer); clearInterval(every); };
  }, [resetKey, settleKey]);

  useLayoutEffect(() => {
    const el = column.current;
    const f = foldRef.current;
    if (!tick || !el || probe.current !== null || (f === 0 && zoom === 1)) return;
    // try less folded (or a larger milestones block) only if the free space could hold it (unknown: try)
    const need = (zoom < 1 ? 0 : grow.current[f] ?? 0) + margin();
    if (columnFree(el) < need) return;
    probe.current = {from: f, climbing: false};
    setZoom(1);
    setFold(0);
  }, [tick]);

  useLayoutEffect(() => {
    const el = column.current;
    if (!el) return;
    // a re-evaluation was asked for in this commit: wait for the render at fold 0
    if (probe.current && !probe.current.climbing) {
      if (fold !== 0 || zoom !== 1) return;
      probe.current.climbing = true;
    }
    const content = el.clientHeight - columnFree(el);
    if (stepFrom.current && stepFrom.current.fold === fold - 1) grow.current[fold] = Math.max(0, stepFrom.current.content - content);
    stepFrom.current = null;
    const over = -columnFree(el);
    if (over > 1 && fold < MAX_FOLD) {
      stepFrom.current = {fold, content};
      setFold((fold + 1) as Fold);
      if (probe.current === null) log('overflow', fold + 1);
      return;
    }
    if (over > 1 && fold === MAX_FOLD) {
      // still too tall at the last level: shrink the milestones/awards block by the overflow
      const st = el.querySelector<HTMLElement>('[data-standings-box]');
      const h = st?.offsetHeight ?? 0;
      if (h > 0 && zoom > MIN_ZOOM) {
        const z = Math.max(MIN_ZOOM, Math.floor((zoom * (h - over - 2)) / h * 100) / 100);
        if (z < zoom) { setZoom(z); log(`zoom ${z}`, fold); return; }
      }
    }
    if (probe.current !== null) {
      const {from} = probe.current;
      probe.current = null;
      if (fold < from && columnFree(el) < margin()) { setFold((fold + 1) as Fold); log('settle (margin)', fold + 1); }
      else log('settle', fold);
    }
  });
  return {fold, zoom};
}
