// Phone tabs that do not flicker in WebKit (iPhone Safari and Chrome).
// Panels stay mounted once visited: switching tabs only hides and shows them, so card art is never
// re-requested or re-decoded and nothing re-lays-out. The shown panel fades in on one layer (opacity only,
// no translate of text), and the underline is a single bar moved with a transform, not a shared-layout
// animation that repaints the header.
import {useLayoutEffect, useRef, useState, type ReactNode} from 'react';
import {perfMark} from '../perf/recorder';

export type TabDef<T extends string> = {id: T; label: ReactNode};

export function TabBar<T extends string>({tabs, value, onChange, style, gap = 20}: {
  tabs: Array<TabDef<T>>; value: T; onChange: (t: T) => void; style?: React.CSSProperties; gap?: number;
}) {
  const refs = useRef(new Map<T, HTMLButtonElement>());
  const [bar, setBar] = useState<{x: number; w: number} | null>(null);
  useLayoutEffect(() => {
    const measure = () => {
      const el = refs.current.get(value);
      if (el) setBar({x: el.offsetLeft, w: el.offsetWidth});
    };
    measure();
    const ro = new ResizeObserver(measure);
    for (const el of refs.current.values()) ro.observe(el);
    return () => ro.disconnect();
  }, [value, tabs.length]);
  return (
    <nav role="tablist" style={{position: 'relative', display: 'flex', gap, ...style}}>
      {tabs.map((t) => (
        <button key={t.id} ref={(el) => { if (el) refs.current.set(t.id, el); else refs.current.delete(t.id); }}
          role="tab" aria-selected={value === t.id} onClick={() => { if (t.id !== value) perfMark('tab', 'start'); onChange(t.id); }}
          style={{position: 'relative', padding: '6px 0', fontWeight: 650, fontVariationSettings: "'wdth' 82", fontSize: 17,
            color: value === t.id ? 'var(--ice)' : 'var(--ice-faint)', transition: 'color .15s'}}>
          {t.label}
        </button>
      ))}
      {bar && (
        // a 100 px bar scaled to the tab's width: transform-only, so the header never repaints
        <span aria-hidden="true" style={{position: 'absolute', left: 0, bottom: (style?.paddingBottom as number | undefined) ?? 0, width: 100, height: 2.5,
          borderRadius: 2, background: 'var(--ice)', transformOrigin: '0 0',
          transform: `translate3d(${bar.x}px, 2px, 0) scaleX(${bar.w / 100})`, transition: 'transform .22s cubic-bezier(.2,.9,.25,1)'}} />
      )}
    </nav>
  );
}

/** Keeps every visited panel mounted and toggles which one is shown. */
export function TabPanels<T extends string>({value, panels, style}: {value: T; panels: Record<T, () => ReactNode>; style?: React.CSSProperties}) {
  const visited = useRef(new Set<T>());
  visited.current.add(value);
  return (
    <div style={{position: 'relative', ...style}}>
      {(Object.keys(panels) as T[]).filter((k) => visited.current.has(k)).map((k) => {
        const on = k === value;
        return (
          <div key={k} role="tabpanel" aria-hidden={!on || undefined} data-tab-panel={k} onAnimationEnd={(e) => { if (on && e.target === e.currentTarget) perfMark('tab', 'end'); }}
            // Hidden panels keep their width (so decks do not re-measure) but take no height and no input.
            // the shown panel starts at 55% opacity, never 0: a blank frame between tabs reads as a flicker
            style={on
              ? {animation: 'tm-tab-in .14s ease-out'}
              : {position: 'absolute', left: 0, right: 0, top: 0, height: 0, overflow: 'hidden', visibility: 'hidden', opacity: 0, pointerEvents: 'none'}}>
            {panels[k]()}
          </div>
        );
      })}
    </div>
  );
}
