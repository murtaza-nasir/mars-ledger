// Your table as collections by card type: a row of collection chips at the top (with counts, and a dot on
// collections holding an unused action) and the chosen collection's cards right beneath, in the same deck
// you flip through in your hand. Each visited collection keeps its deck mounted, so switching collections
// never re-decodes card art (that flickered on iPhones).
import {useEffect, useRef, useState, type ReactNode} from 'react';
import {TYPE_COLOR} from '../CardFace';
import {TabPanels} from '../Tabs';
import {DeckCarousel, type DeckItem} from './Deck';

export type Pile = {key: string; label: string; items: DeckItem[]; faceDown?: boolean; ready?: number};

const KEY = 'mars-ledger-table-collection';
const readPick = (): string | null => { try { return localStorage.getItem(KEY); } catch { return null; } };
const savePick = (k: string) => { try { localStorage.setItem(KEY, k); } catch { /* private mode */ } };

export function Piles({piles, onOpen, openKey, extra, onPick}: {piles: Pile[]; onOpen: (pile: string, key: string) => void; openKey?: string | null; extra?: ReactNode;
  /** The collection now shown (the lifted view moves through this one). */
  onPick?: (pile: string) => void}) {
  const shown = piles.filter((p) => p.items.length);
  const [pick, setPick] = useState<string | null>(readPick);
  // A remembered collection the player no longer has falls back to the one with a ready action, else the first.
  const current = shown.find((p) => p.key === pick) ?? shown.find((p) => p.ready) ?? shown[0];
  useEffect(() => { if (current) onPick?.(current.key); }, [current?.key]); // eslint-disable-line react-hooks/exhaustive-deps
  const choose = (k: string) => { setPick(k); savePick(k); };
  const row = useRef<HTMLDivElement>(null);
  // keep the chosen chip in view inside the scrolling chip row (horizontal only, never the page)
  useEffect(() => {
    const r = row.current; const el = r?.querySelector<HTMLElement>(`[data-collection="${current?.key}"]`);
    if (!r || !el) return;
    const left = el.offsetLeft - 8, right = el.offsetLeft + el.offsetWidth + 8;
    if (left < r.scrollLeft) r.scrollTo({left, behavior: 'smooth'});
    else if (right > r.scrollLeft + r.clientWidth) r.scrollTo({left: right - r.clientWidth, behavior: 'smooth'});
  }, [current?.key]);
  if (!current) return <p className="muted" style={{margin: '8px 2px'}}>Cards you play land here.</p>;
  return (
    <div>
      <div ref={row} role="tablist" aria-label="Collections" data-testid="table-collections"
        style={{display: 'flex', gap: 8, overflowX: 'auto', padding: '2px 2px 10px', margin: '0 -2px', scrollbarWidth: 'none',
          // a soft fade on the right edge says more collections scroll into view
          WebkitMaskImage: 'linear-gradient(90deg, #000 88%, transparent)', maskImage: 'linear-gradient(90deg, #000 88%, transparent)'}}>
        {shown.map((p) => {
          const on = p.key === current.key;
          const edge = TYPE_COLOR[p.items[0].card.type] ?? '#888';
          return (
            <button key={p.key} type="button" role="tab" aria-selected={on} data-collection={p.key} onClick={() => choose(p.key)}
              style={{flex: 'none', display: 'inline-flex', alignItems: 'center', gap: 7, minHeight: 40, padding: '0 14px 0 12px', borderRadius: 999,
                fontWeight: 650, fontVariationSettings: "'wdth' 84", fontSize: 15,
                background: on ? 'var(--ice)' : 'rgba(255,255,255,.06)', color: on ? 'var(--dusk-1)' : 'var(--ice)',
                boxShadow: on ? 'none' : `inset 0 0 0 1.5px color-mix(in oklab, ${edge} 55%, transparent)`, transition: 'background .15s, color .15s'}}>
              <span aria-hidden="true" style={{width: 9, height: 9, borderRadius: 3, background: edge, flex: 'none'}} />
              {p.label}
              <span className="num" style={{fontSize: 13, opacity: 0.75}}>{p.items.length}</span>
              {p.ready ? <span aria-label={`${p.ready} action${p.ready > 1 ? 's' : ''} ready`} title="Action ready"
                style={{width: 8, height: 8, borderRadius: 4, background: '#6FB8E8', boxShadow: '0 0 0 3px rgba(111,184,232,.25)'}} /> : null}
            </button>
          );
        })}
      </div>
      {current.ready ? (
        <p style={{margin: '0 2px 2px', fontSize: 14, color: '#6FB8E8', fontWeight: 600}}>
          {current.ready} {current.ready === 1 ? 'action' : 'actions'} ready · lift a card to use it
        </p>
      ) : null}
      <TabPanels value={current.key} panels={Object.fromEntries(shown.map((p) => [p.key, () => (
        // the same height budget as the hand: the card, its note and dots fit above the dock without scrolling
        <DeckCarousel items={p.items} onOpen={(k) => onOpen(p.key, k)} openKey={openKey} layoutPrefix={`pile-${p.key}`} label={p.label} reserveBottom={104} />
      )]))} />
      {extra}
    </div>
  );
}
