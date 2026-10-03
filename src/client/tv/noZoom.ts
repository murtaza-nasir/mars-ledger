// The TV page has nothing to scroll or zoom, so stray wheel and pinch gestures are swallowed. A ctrl+wheel (also what a
// touchpad pinch sends) would zoom the browser into one corner of the 3D board, with no easy way back out. Panels that do scroll (the options) mark themselves with data-tv-scroll and keep their wheel.
export function installNoZoom(): () => void {
  const onWheel = (e: WheelEvent) => {
    if (e.ctrlKey) { e.preventDefault(); return; }
    const t = e.target as Element | null;
    if (!t?.closest?.('[data-tv-scroll]')) e.preventDefault();
  };
  // Safari's own pinch events
  const onGesture = (e: Event) => e.preventDefault();
  const onTouch = (e: TouchEvent) => { if (e.touches.length > 1) e.preventDefault(); };
  window.addEventListener('wheel', onWheel, {passive: false});
  window.addEventListener('gesturestart', onGesture as EventListener, {passive: false} as AddEventListenerOptions);
  window.addEventListener('gesturechange', onGesture as EventListener, {passive: false} as AddEventListenerOptions);
  window.addEventListener('touchmove', onTouch, {passive: false});
  return () => {
    window.removeEventListener('wheel', onWheel);
    window.removeEventListener('gesturestart', onGesture as EventListener);
    window.removeEventListener('gesturechange', onGesture as EventListener);
    window.removeEventListener('touchmove', onTouch);
  };
}
