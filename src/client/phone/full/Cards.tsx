// Cards in full mode: the hand as a deck, the dealt spread used by research/draft/actions, and the keep pile.
import {AnimatePresence, motion} from 'motion/react';
import {useEffect, useMemo, useState} from 'react';
import type {CardModel, PlayerViewModel} from '../../../shared/full';
import type {CardHint} from '../../../shared/hints';
import {effectiveView, filterHand, HAND_SORTS, handTagCounts, parseHandView, SORT_LABEL, sortHand} from '../../../shared/synergy';
import type {HandEntry, HandFilter, HandSort, HandView, Synergy} from '../../../shared/synergy';
import {CardBack, CardFace} from '../../ui/CardFace';
import {DeckCarousel, type DeckItem} from '../../ui/deck/Deck';
import {TagIcon} from '../../ui/Icons';
import {CardRow, InfoButton, useCardPeek} from './CardRow';
import {cardDef} from './model';

export function FullCard({card, compact, cost, dim}: {card: CardModel; compact?: boolean; cost?: number; dim?: boolean}) {
  const def = cardDef(card.name);
  return (
    <div style={{position: 'relative', opacity: dim ? 0.5 : 1, transition: 'opacity .3s'}}>
      <CardFace card={def} compact={compact} cost={cost ?? card.calculatedCost ?? undefined} resources={card.resources} hideAutomation />
    </div>
  );
}

/** What a hand card needs to be played: the M€ it is short, counting metals that can pay for it. */
export function shortfall(model: PlayerViewModel, c: CardModel): number {
  const def = cardDef(c.name);
  const me = model.thisPlayer;
  const cost = c.calculatedCost ?? def.cost ?? 0;
  const metals = (def.tags.includes('building') ? me.steel * me.steelValue : 0) + (def.tags.includes('space') ? me.titanium * me.titaniumValue : 0);
  return Math.max(0, cost - me.megacredits - metals);
}

/** The hand: a deck to riffle through. Playable cards glow; cards you cannot afford say by how much. */
export function HandDeck({model, cards, playable, menu, onOpen, openKey, hints, lineAbove, synergies, onOrder, tools}: {
  /** a chip at the end of the tools row (the off-turn plan tray) */
  tools?: React.ReactNode;
  model: PlayerViewModel; cards: CardModel[]; playable: Map<string, number>; menu: boolean; onOpen: (c: CardModel) => void; openKey?: string | null;
  /** smart hints: cards one requirement away (only when the player turned hints on) */
  hints?: CardHint[];
  /** extra room above the dock (the hint line sits there on your turn) */
  lineAbove?: boolean;
  /** hand tools: how each card works with what is already in play */
  synergies?: Map<string, Synergy[]>;
  /** the order the deck shows (after sort and filter), so the lifted view can move along it */
  onOrder?: (names: string[]) => void;
}) {
  const [stored, setStored] = useHandView();
  const entries: HandEntry[] = useMemo(() => cards.map((c) => ({
    name: c.name, def: cardDef(c.name), cost: playable.get(c.name) ?? c.calculatedCost ?? cardDef(c.name).cost ?? 0, playable: playable.has(c.name),
  })), [cards, playable]);
  const view = effectiveView(stored, entries);
  const shown = useMemo(() => filterHand(sortHand(entries, view.sort), view.filter), [entries, view.sort, view.filter]);
  // Test hook (like window.__hints): the order the deck shows, for the model it came from.
  useEffect(() => {
    (window as unknown as {__hand: unknown}).__hand = {age: model.game.gameAge, undo: model.game.undoCount, view, shown: shown.map((e) => e.name),
      synergy: Object.fromEntries([...(synergies ?? new Map<string, Synergy[]>())].map(([k, v]) => [k, v.map((x) => x.kind + ':' + x.source)]))};
  }, [shown, view, model.game.gameAge, model.game.undoCount, synergies]);
  const order = shown.map((e) => e.name).join('\u0000');
  useEffect(() => { onOrder?.(order ? order.split('\u0000') : []); }, [order, onOrder]);
  // a filter hides cards quietly; anything else that leaves the hand was played and flies off
  const [quiet, setQuiet] = useState(false);
  const change = (v: HandView) => { setQuiet(true); setStored(v); window.setTimeout(() => setQuiet(false), 400); };
  const items: DeckItem[] = useMemo(() => shown.map(({name}) => {
    const c = cards.find((x) => x.name === name)!;
    const can = playable.has(c.name);
    const short = shortfall(model, c);
    const hint = can ? undefined : hints?.find((h) => h.card === c.name);
    return {
      badge: hint?.badge, synergy: (synergies?.get(c.name)?.length ?? 0) > 0,
      key: c.name, card: cardDef(c.name), cost: playable.get(c.name) ?? c.calculatedCost, resources: c.resources || undefined,
      glow: can ? 'play' as const : undefined, dim: menu && !can,
      note: can ? <span style={{color: 'var(--mc)', fontWeight: 650}}>Playable now · tap to lift</span>
        : short > 0 ? <span style={{color: '#FFB39E'}}>{short} M€ short</span>
          : hint ? <span style={{color: 'var(--tr)'}}>{hint.facts[hint.facts.length - 1]}</span>
            : menu ? <span className="faint">Requirements not met yet</span> : <span className="faint">Tap to lift and read</span>,
    };
  }), [shown, cards, playable, menu, model, hints, synergies]);
  if (!cards.length) {
    return <p className="muted" style={{padding: '24px 4px'}}>Your hand is empty. Cards you buy in research land here.</p>;
  }
  return (
    <div>
      <HandTools view={view} entries={entries} onChange={change} extra={tools} />
      {items.length ? (
        <DeckCarousel items={items} onOpen={(k) => { const c = cards.find((x) => x.name === k); if (c) onOpen(c); }} openKey={openKey} layoutPrefix="hand" label="Your hand"
          reserveBottom={lineAbove ? 150 : 104} exitStyle={quiet ? 'quiet' : 'play'} resetKey={`${view.sort}|${view.filter}`} minWidth={156} />
      ) : (
        <motion.div key={view.filter} initial={{opacity: 0, y: 8}} animate={{opacity: 1, y: 0}} data-testid="hand-empty"
          style={{margin: '18px 0 8px', padding: '28px 18px', borderRadius: 18, textAlign: 'center', background: 'rgba(255,255,255,.04)', boxShadow: 'inset 0 0 0 1px var(--rim)'}}>
          <div style={{fontWeight: 700, fontSize: 17}}>{view.filter === 'playable' ? 'No playable cards right now' : 'No cards with this tag'}</div>
          <button className="btn ghost" style={{marginTop: 14, minHeight: 40, fontSize: 15}} onClick={() => change({...view, filter: 'all'})}>Show all {cards.length}</button>
        </motion.div>
      )}
    </div>
  );
}

const VIEW_KEY = 'mars-ledger-hand-view';

/** Sort and filter, remembered on this device. */
function useHandView(): [HandView, (v: HandView) => void] {
  const [view, setView] = useState<HandView>(() => {
    try { return parseHandView(localStorage.getItem(VIEW_KEY)); } catch { return parseHandView(null); }
  });
  const set = (v: HandView) => {
    setView(v);
    try { localStorage.setItem(VIEW_KEY, JSON.stringify(v)); } catch { /* private mode: keep it for this visit */ }
  };
  return [view, set];
}

/** One slim row above the deck: a sort menu and filter chips (playable, then each tag in the hand). */
function HandTools({view, entries, onChange, extra}: {view: HandView; entries: HandEntry[]; onChange: (v: HandView) => void; extra?: React.ReactNode}) {
  const [open, setOpen] = useState(false);
  const playableN = entries.filter((e) => e.playable).length;
  const chips: Array<{f: HandFilter; label: React.ReactNode; n: number}> = [
    {f: 'all', label: 'All', n: entries.length},
    {f: 'playable', label: 'Playable', n: playableN},
    ...handTagCounts(entries).map(([t, n]) => ({f: t as HandFilter, label: <TagIcon tag={t} size={18} />, n})),
  ];
  return (
    <div data-testid="hand-tools" style={{position: 'relative', display: 'flex', alignItems: 'center', gap: 8, height: 34, margin: '0 -16px', padding: '0 16px'}}>
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu" data-testid="hand-sort"
        style={{flex: 'none', display: 'inline-flex', alignItems: 'center', gap: 5, height: 30, padding: '0 10px', borderRadius: 999, fontSize: 13.5, fontWeight: 650,
          background: 'rgba(255,255,255,.07)', boxShadow: 'inset 0 0 0 1px var(--rim)'}}>
        <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 3v10M4 13l-2.5-2.5M4 13l2.5-2.5M11 13V3M11 3 8.5 5.5M11 3l2.5 2.5" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
        {SORT_LABEL[view.sort]}
      </button>
      <div role="tablist" aria-label="Filter your hand" style={{display: 'flex', gap: 6, overflowX: 'auto', scrollbarWidth: 'none', flex: 1, padding: '2px 18px 2px 0',
        // a soft fade on the right says the strip scrolls when the hand has more tags than fit
        maskImage: 'linear-gradient(90deg, #000 calc(100% - 22px), transparent)', WebkitMaskImage: 'linear-gradient(90deg, #000 calc(100% - 22px), transparent)'}}>
        {chips.map((c) => {
          const on = view.filter === c.f;
          return (
            <motion.button key={c.f} role="tab" aria-selected={on} data-filter={c.f} whileTap={{scale: 0.94}} onClick={() => onChange({...view, filter: c.f})}
              style={{position: 'relative', flex: 'none', display: 'inline-flex', alignItems: 'center', gap: 4, height: 30, padding: '0 10px', borderRadius: 999, fontSize: 13.5, fontWeight: 650,
                color: on ? '#24130F' : 'var(--ice-dim)'}}>
              {on && <motion.span layoutId="hand-filter" transition={{type: 'spring', stiffness: 420, damping: 34}}
                style={{position: 'absolute', inset: 0, borderRadius: 999, background: c.f === 'playable' ? 'var(--mc)' : 'var(--ice)'}} />}
              {!on && <span aria-hidden="true" style={{position: 'absolute', inset: 0, borderRadius: 999, boxShadow: 'inset 0 0 0 1px var(--rim)'}} />}
              <span style={{position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 4}}>{c.label}<span className="num" style={{fontSize: 12, opacity: 0.75}}>{c.n}</span></span>
            </motion.button>
          );
        })}
      </div>
      {extra}
      {open && <div aria-hidden="true" onClick={() => setOpen(false)} style={{position: 'fixed', inset: 0, zIndex: 29}} />}
      <AnimatePresence>
        {open && (
          <motion.div role="menu" initial={{opacity: 0, y: -6, scale: 0.96}} animate={{opacity: 1, y: 0, scale: 1}} exit={{opacity: 0, y: -6, scale: 0.96}} transition={{duration: 0.16}}
            style={{position: 'absolute', top: 36, left: 16, zIndex: 30, minWidth: 170, padding: 6, borderRadius: 14, background: 'var(--dusk-2)',
              boxShadow: '0 0 0 1px var(--rim-strong), 0 18px 40px rgba(0,0,0,.55)'}}>
            {HAND_SORTS.map((k: HandSort) => (
              <button key={k} role="menuitemradio" aria-checked={view.sort === k} data-sort={k} onClick={() => { setOpen(false); onChange({...view, sort: k}); }}
                style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', padding: '10px 12px', borderRadius: 10, fontSize: 15,
                  fontWeight: view.sort === k ? 700 : 500, background: view.sort === k ? 'rgba(255,255,255,.07)' : 'transparent'}}>
                {SORT_LABEL[k]}{view.sort === k && <span style={{color: 'var(--mc)'}}>●</span>}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * Cards to pick from, dealt face down and turned over one by one. Selected cards lift and glow.
 * Every card stays in the page (no virtualising) so it can be tapped directly.
 * Long lists (compact) are rows with a summary of each card and an info button for the full card.
 */
export function CardPicker({cards, selected, onToggle, disabledNames, compact}: {
  cards: CardModel[]; selected: Set<string>; onToggle: (name: string) => void; disabledNames?: Set<string>; compact?: boolean;
}) {
  const {peek, viewer} = useCardPeek(useMemo(() => cards.map((c) => ({name: c.name, def: cardDef(c.name), cost: c.calculatedCost ?? undefined, resources: c.resources || undefined})), [cards]));
  if (compact) return <CardRowPicker cards={cards} selected={selected} onToggle={onToggle} disabledNames={disabledNames} peek={peek} viewer={viewer} />;
  return (
    <div style={{display: 'grid', gap: 0}}>
      {cards.map((c, i) => {
        const on = selected.has(c.name);
        const off = disabledNames?.has(c.name) || c.isDisabled;
        const tilt = i % 2 ? 0.9 : -0.9;
        return (
          <motion.button key={c.name} data-card={c.name} onClick={() => !off && onToggle(c.name)} disabled={off} aria-pressed={on}
            initial={{opacity: 0, y: 50}} animate={{opacity: off ? 0.42 : 1, y: on ? -10 : 0, rotate: on ? 0 : tilt, scale: on ? 1.015 : 1}}
            transition={{delay: 0.32 + Math.min(i, 10) * 0.1, type: 'spring', stiffness: 150, damping: 19}}
            whileTap={{scale: 0.985}}
            style={{position: 'relative', display: 'block', width: '100%', textAlign: 'left', marginTop: i === 0 ? 0 : -14, zIndex: on ? 5 : 1,
              borderRadius: 20, boxShadow: on ? '0 0 0 2.5px var(--mc), 0 18px 40px rgba(0,0,0,.55), 0 0 36px rgba(242,194,48,.25)' : 'none', transition: 'box-shadow .2s'}}>
            {/* The turn-over is 2D: the card narrows edge-on, the back gives way to the face, and it widens
                again. WebKit (every iPhone browser) flickers on 3D turns with hidden back faces. */}
            <motion.div initial={{scaleX: 1}} animate={{scaleX: [1, 0.02, 1]}}
              transition={{delay: 0.42 + Math.min(i, 10) * 0.1, duration: 0.56, times: [0, 0.5, 1], ease: ['easeIn', 'easeOut']}}
              style={{position: 'relative'}}>
              <CardFace card={cardDef(c.name)} cost={c.calculatedCost ?? undefined} resources={c.resources || undefined} artAspect="2 / 1" hideAutomation style={{aspectRatio: 'auto'}} />
              <motion.div aria-hidden="true" initial={{opacity: 1}} animate={{opacity: [1, 1, 0]}}
                transition={{delay: 0.42 + Math.min(i, 10) * 0.1, duration: 0.56, times: [0, 0.5, 0.501]}}
                style={{position: 'absolute', inset: 0, pointerEvents: 'none'}}>
                <CardBack style={{aspectRatio: 'auto', height: '100%'}} />
              </motion.div>
            </motion.div>
            <PickedMark on={on} />
          </motion.button>
        );
      })}
    </div>
  );
}

function PickedMark({on}: {on: boolean}) {
  return (
    <AnimatePresence>
      {on && (
        <motion.span initial={{scale: 0, rotate: -40}} animate={{scale: 1, rotate: 0}} exit={{scale: 0}} transition={{type: 'spring', stiffness: 500, damping: 22}}
          style={{position: 'absolute', top: -8, right: -6, width: 32, height: 32, borderRadius: 16, background: 'var(--mc)', display: 'grid', placeItems: 'center',
            boxShadow: '0 4px 14px rgba(0,0,0,.5)', zIndex: 3, pointerEvents: 'none'}}>
          <svg width="16" height="16" viewBox="0 0 16 16"><path d="M3 8.5 6.5 12 13 4.5" stroke="#24130F" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </motion.span>
      )}
    </AnimatePresence>
  );
}

/** The long list as rows: the row picks the card, the info button beside it opens the full card. The lift and the
 *  ring sit on the wrapper, so the info button moves with its row. */
function CardRowPicker({cards, selected, onToggle, disabledNames, peek, viewer}: {
  cards: CardModel[]; selected: Set<string>; onToggle: (name: string) => void; disabledNames?: Set<string>; peek: (name: string) => void; viewer: React.ReactNode;
}) {
  return (
    <div style={{display: 'grid', gap: 8}}>
      {cards.map((c, i) => {
        const on = selected.has(c.name);
        const off = disabledNames?.has(c.name) || c.isDisabled;
        return (
          <motion.div key={c.name} initial={{opacity: 0, y: 30}} animate={{opacity: off ? 0.42 : 1, y: on ? -4 : 0}}
            transition={{delay: 0.2 + Math.min(i, 8) * 0.05, type: 'spring', stiffness: 220, damping: 24}}
            style={{position: 'relative', zIndex: on ? 5 : 1, borderRadius: 16,
              boxShadow: on ? '0 0 0 2.5px var(--mc), 0 0 28px rgba(242,194,48,.22)' : 'none', transition: 'box-shadow .2s'}}>
            <motion.button data-card={c.name} onClick={() => !off && onToggle(c.name)} disabled={off} aria-pressed={on} whileTap={{scale: 0.985}}
              style={{display: 'block', width: '100%', textAlign: 'left', borderRadius: 16}}>
              <CardRow card={cardDef(c.name)} cost={c.calculatedCost ?? undefined} resources={c.resources || undefined} info />
            </motion.button>
            <InfoButton name={c.name} onOpen={() => peek(c.name)} />
            <PickedMark on={on} />
          </motion.div>
        );
      })}
      {viewer}
    </div>
  );
}

/** Selected cards gathered into a small fanned pile beside the confirm button. */
export function KeepPile({names, label}: {names: string[]; label?: string}) {
  return (
    <div aria-label={label ?? `${names.length} kept`} style={{position: 'relative', width: 50 + Math.max(0, Math.min(names.length, 5) - 1) * 9, height: 62, flex: 'none'}}>
      <AnimatePresence>
        {names.slice(-5).map((n, i, arr) => (
          <motion.div key={n} initial={{opacity: 0, y: -60, scale: 1.6, rotate: -20}}
            animate={{opacity: 1, y: 0, scale: 1, rotate: (i - (arr.length - 1) / 2) * 5}} exit={{opacity: 0, y: -30, scale: 0.8}}
            transition={{type: 'spring', stiffness: 320, damping: 22}}
            style={{position: 'absolute', left: i * 9, top: 2, width: 50, transformOrigin: '50% 130%'}}>
            <CardFace card={cardDef(n)} variant="thumb" />
          </motion.div>
        ))}
      </AnimatePresence>
      {names.length > 0 && (
        <motion.span key={names.length} initial={{scale: 1.6}} animate={{scale: 1}} className="num"
          style={{position: 'absolute', right: -6, bottom: -4, minWidth: 22, height: 22, padding: '0 6px', borderRadius: 11, display: 'grid', placeItems: 'center',
            background: 'var(--mc)', color: '#2A1A04', fontSize: 13, zIndex: 10}}>{names.length}</motion.span>
      )}
    </div>
  );
}
