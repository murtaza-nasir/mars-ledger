// A viewport height that does not move when a phone's browser toolbar shows or hides.
// iPhone browsers (Safari and Chrome, both WebKit) and Android Chrome change window.innerHeight and
// 100dvh as the address bar collapses while scrolling; anything sized from them (cards, the lifted view)
// then resizes and its text re-wraps. The small viewport height (100svh) is the height with the toolbar
// showing: known from the first frame, constant while scrolling, and everything sized from it always fits.
// It is re-read only when the width or the orientation really changes.
import {useEffect, useState} from 'react';

let probe: HTMLDivElement | null = null;

function readSmallHeight(): number {
  if (typeof document === 'undefined') return 800;
  if (!probe) {
    probe = document.createElement('div');
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText = 'position:fixed;left:0;top:0;width:0;visibility:hidden;pointer-events:none;height:100vh;height:100svh';
    document.body.appendChild(probe);
  }
  const h = probe.offsetHeight;
  // Browsers without svh report 100vh, which on iOS is the large height; never trust it above innerHeight.
  return h > 0 ? Math.min(h, Math.max(window.innerHeight, 1) + 140) : window.innerHeight;
}

type Stable = {width: number; height: number};
let current: Stable | null = null;
const listeners = new Set<(s: Stable) => void>();

function measure(force = false) {
  const width = document.documentElement.clientWidth;
  const portrait = window.innerHeight >= width;
  const wasPortrait = current ? current.height >= current.width : portrait;
  // Height-only changes (the toolbar) are ignored; a real width or orientation change re-reads.
  if (!force && current && Math.abs(current.width - width) <= 4 && portrait === wasPortrait) return;
  const next = {width, height: readSmallHeight()};
  if (current && next.width === current.width && next.height === current.height) return;
  current = next;
  for (const l of listeners) l(next);
}

let wired = false;
function wire() {
  if (wired || typeof window === 'undefined') return;
  wired = true;
  window.addEventListener('resize', () => measure());
  window.addEventListener('orientationchange', () => setTimeout(() => measure(true), 250));
}

/** The stable viewport: width, and the small (toolbar-showing) height. */
export function stableViewport(): Stable {
  wire();
  if (!current) measure(true);
  return current!;
}

export function useStableViewport(): Stable {
  const [v, setV] = useState<Stable>(() => stableViewport());
  useEffect(() => {
    listeners.add(setV);
    setV(stableViewport());
    return () => { listeners.delete(setV); };
  }, []);
  return v;
}
