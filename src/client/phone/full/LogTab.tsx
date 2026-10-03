// The phone's Log tab: the game log read as moves, newest first. A move is the line that starts an action (a card
// played, a card's action, a standard project, a conversion, a claim or a funding) with the lines it caused folded
// under it; logMoves.ts does the reading and falls back to single lines when it cannot prove a line belongs to a
// move. Every card name and every move's thumbnail opens the lifted card view with "What happened" under the card.
//
// iPhone notes: rows are memoised by key and re-render only when their own lines change; the list holds at most the
// engine's 50 newest lines (capped again below); no backdrop-filter, no blend modes, no layout animation. When new
// lines arrive while the player is reading further down, the scroll position is kept on the row they were reading.
import {motion} from 'motion/react';
import {createContext, memo, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState} from 'react';
import type {ReactNode} from 'react';
import type {Color, LogLine, PlayerViewModel} from '../../../shared/full';
import {findCard} from '../../../shared/cards';
import {CardFace} from '../../ui/CardFace';
import {CardViewer} from '../../ui/deck/Viewer';
import {PLAYER_HEX, ResIcon} from '../../ui/Icons';
import {cardDef, standardProject} from './model';
import {useLogHistory} from './logHistory';
import {useNet} from '../../net';
import {echoTargets, replayable} from './logLinks';
import {MoveTvLinks} from './TvLinks';
import {cardLabel, cardsOfMove, groupLog, headline, movesWithCard, plain, segments, shownLines, newestFirst, summary, victimOf} from './logMoves';
import type {LogEntry, Seg} from './logMoves';

type Move = Extract<LogEntry, {kind: 'move'}>;
/** Rows drawn at first; "Show older moves" adds as many again. */
const ROWS_PAGE = 60;
/** Phrases shown in a move's one-line summary before "and N more". */
const SUMMARY_MAX = 4;

// ---- shared bits ----------------------------------------------------------------------------------------------------
/** `tv`: a TV is at the table (moves then offer "Replay on the TV" and "Show on the TV" when expanded) */
type Ctx = {names: Record<string, string>; me: Color; openCard: (name: string, move: Move | null) => void; tv: boolean};
const LogCtx = createContext<Ctx>({names: {}, me: 'red' as Color, openCard: () => {}, tv: false});

const hex = (c: Color | null | undefined) => (c ? PLAYER_HEX[c as keyof typeof PLAYER_HEX] ?? 'var(--ice-dim)' : 'var(--rim-strong)');
/** A card the phone can show (a project, corporation or prelude card, or a standard project). */
const showable = (name: string) => !!findCard(name) || !!standardProject(name);

/** Segments as text: player names in their colours, card names as buttons that open the card. */
function Segs({segs, move, cards = true, current}: {segs: Seg[]; move: Move | null; cards?: boolean; current?: string}) {
  const {names, me, openCard} = useContext(LogCtx);
  // the seat's private lines start with the word "You": it is the seat, in its colour like any other name
  const own: Seg[] = segs[0]?.t === 'text' && /^You /.test(segs[0].v) ? [{t: 'player', color: me}, {t: 'text', v: segs[0].v.slice(3)}, ...segs.slice(1)] : segs;
  return (
    <>
      {own.map((s, i) => {
        if (s.t === 'text') return <span key={i}>{s.v}</span>;
        if (s.t === 'player') {
          return <span key={i} style={{color: hex(s.color), fontWeight: 680}}>{s.color === me ? 'You' : names[s.color] ?? s.color}</span>;
        }
        if (!cards || s.name === current || !showable(s.name)) return <span key={i} style={{fontWeight: 650}}>{cardLabel(s.name)}</span>;
        return (
          <button key={i} type="button" data-testid="log-card" onClick={(e) => { e.stopPropagation(); openCard(s.name, move); }}
            style={{display: 'inline', padding: 0, margin: 0, background: 'none', color: 'var(--ice)', fontWeight: 680, font: 'inherit', fontVariationSettings: 'inherit',
              textDecoration: 'underline', textDecorationColor: 'var(--rim-strong)', textDecorationThickness: 1.5, textUnderlineOffset: 3, cursor: 'pointer'}}>
            {cardLabel(s.name)}
          </button>
        );
      })}
    </>
  );
}

/** "You" reads oddly in the middle of the engine's sentences about other players: names for the summary text. */
function useNameOf() {
  const {names, me} = useContext(LogCtx);
  return (c: Color) => (c === me ? 'you' : names[c] ?? c);
}

// ---- the tab --------------------------------------------------------------------------------------------------------
export const LogTab = memo(function LogTab({model, logs: windowLines}: {model: PlayerViewModel; logs: LogLine[]}) {
  // what this phone has seen since it loaded, not only the engine's newest 50 lines
  const logs = useLogHistory(windowLines);
  const me = model.color;
  const generation = model.game.generation;
  // the grouping depends on the lines only: a new view with the same log keeps the same entries (and rows)
  const logSig = logs.length ? `${logs.length}|${logs[0].timestamp}|${logs[logs.length - 1].timestamp}|${logs[logs.length - 1].message}` : '';
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const entries = useMemo(() => groupLog(logs, me, generation), [logSig, me, generation]);
  const namesSig = model.players.map((p) => `${p.color}:${p.name}`).join('|');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const names = useMemo(() => Object.fromEntries(model.players.map((p) => [p.color, p.name])) as Record<string, string>, [namesSig]);

  const [viewer, setViewer] = useState<{cards: string[]; index: number; move: Move | null} | null>(null);
  const openCard = useCallback((name: string, move: Move | null) => {
    const list = move ? cardsOfMove(move).filter(showable) : [];
    const cards = list.includes(name) ? list : [name];
    setViewer({cards, index: cards.indexOf(name), move});
    navigator.vibrate?.(6);
  }, []);
  const tv = useNet((s) => s.tvs > 0);
  const ctx = useMemo<Ctx>(() => ({names, me, openCard, tv}), [names, me, openCard, tv]);

  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const toggle = useCallback((key: string) => setOpen((s) => {
    const n = new Set(s);
    if (n.has(key)) n.delete(key); else n.add(key);
    return n;
  }), []);

  const [limit, setLimit] = useState(ROWS_PAGE);
  const all = useMemo(() => newestFirst(entries), [entries]);
  const rows = useMemo(() => all.slice(0, limit), [all, limit]);
  const listRef = useAnchoredScroll(rows);
  // rows that arrive after the tab first drew fade in; the first draw does not animate
  const known = useRef<Set<string> | null>(null);
  if (!known.current) known.current = new Set(rows.map((r) => r.key));
  const fresh = (key: string) => !known.current!.has(key);
  useLayoutEffect(() => { for (const r of rows) known.current!.add(r.key); }, [rows]);

  if (!logs.length) return <p className="muted">The game log appears here as the table plays.</p>;
  return (
    <LogCtx.Provider value={ctx}>
      <ol ref={listRef} data-testid="log-list" style={{listStyle: 'none', margin: 0, padding: '2px 0 8px', display: 'flex', flexDirection: 'column', gap: 6, overflowAnchor: 'none'}}>
        {rows.map((e) => (
          <li key={e.key} data-log-key={e.key} style={{listStyle: 'none'}}>
            <Entry e={e} sig={sigOf(e)} expanded={open.has(e.key)} onToggle={toggle} fresh={fresh(e.key)} />
          </li>
        ))}
      </ol>
      {all.length > rows.length && (
        <button type="button" className="btn ghost" data-testid="log-older" onClick={() => setLimit((n) => n + ROWS_PAGE)} style={{width: '100%', margin: '4px 0 12px'}}>
          Show older moves
        </button>
      )}
      <MoveViewer viewer={viewer} entries={entries} model={model} onChange={setViewer} />
    </LogCtx.Provider>
  );
});

const sigOf = (e: LogEntry) => `${e.key}|${e.kind === 'move' || e.kind === 'research' || e.kind === 'run' ? e.lines.length : 0}|${e.kind === 'generation' ? e.first ?? '' : ''}`;

/**
 * New rows go in at the top. When the player is reading further down, keep the row they are looking at where it
 * is (WebKit has no scroll anchoring, and the page, not the list, scrolls).
 */
function useAnchoredScroll(rows: LogEntry[]) {
  const ref = useRef<HTMLOListElement>(null);
  const anchor = useRef<{key: string; top: number} | null>(null);
  // read the anchor from the page as it is before this render's rows are committed
  const el = ref.current;
  // not while the tab is hidden (its panel stays mounted under the others)
  if (el && !el.closest('[aria-hidden="true"]') && typeof window !== 'undefined') {
    const listTop = el.getBoundingClientRect().top;
    anchor.current = null;
    // only once the newest rows are scrolled away under the tab bar: at the top, new rows simply appear
    if (listTop < 64) {
      for (const li of Array.from(el.children) as HTMLElement[]) {
        const r = li.getBoundingClientRect();
        if (r.bottom > 60) { anchor.current = {key: li.dataset.logKey ?? '', top: r.top}; break; }
      }
    }
  }
  useLayoutEffect(() => {
    const a = anchor.current;
    anchor.current = null;
    if (!a || !ref.current) return;
    const li = Array.from(ref.current.children).find((x) => (x as HTMLElement).dataset.logKey === a.key) as HTMLElement | undefined;
    if (!li) return;
    const d = li.getBoundingClientRect().top - a.top;
    if (Math.abs(d) >= 1) window.scrollBy(0, d);
  }, [rows]);
  return ref;
}

// ---- rows -----------------------------------------------------------------------------------------------------------
const Entry = memo(function Entry({e, expanded, onToggle, fresh: freshProp}: {e: LogEntry; sig: string; expanded: boolean; onToggle: (key: string) => void; fresh: boolean}) {
  // decided once per row: the wrapper never comes or goes after the row first drew (that would remount its card art)
  const [fresh] = useState(freshProp);
  const body = (() => {
    switch (e.kind) {
      case 'generation': return <GenerationRow g={e.generation} first={e.first} />;
      case 'move': return <MoveRow m={e} expanded={expanded} onToggle={onToggle} />;
      case 'research': return <ResearchRow lines={e.lines} />;
      case 'run': return <RunRow k={e.key} lines={e.lines} expanded={expanded} onToggle={onToggle} />;
      case 'line': return <LineRow line={e.line} by={e.by} />;
    }
  })();
  if (!fresh) return body;
  return <motion.div initial={{opacity: 0}} animate={{opacity: 1}} transition={{duration: 0.3}}>{body}</motion.div>;
}, (a, b) => a.sig === b.sig && a.expanded === b.expanded && a.onToggle === b.onToggle);

function GenerationRow({g, first}: {g: number; first?: Color}) {
  const {names, me} = useContext(LogCtx);
  return (
    <div data-testid="log-generation" style={{display: 'flex', alignItems: 'center', gap: 10, margin: '12px 2px 2px'}}>
      <span className="cond" style={{fontWeight: 700, fontSize: 16, color: 'var(--ice)'}}>Generation {g}</span>
      {first && <span style={{fontSize: 12.5, color: 'var(--ice-dim)'}}><span style={{color: hex(first), fontWeight: 650}}>{first === me ? 'You' : names[first] ?? first}</span> {first === me ? 'go' : 'goes'} first</span>}
      <span style={{flex: 1, height: 1, background: 'var(--rim)'}} />
    </div>
  );
}

/** The small picture at the left of a move: the card, or a glyph for moves without one. */
function MoveThumb({m}: {m: Move}) {
  const {openCard} = useContext(LogCtx);
  const card = m.card && showable(m.card) ? m.card : null;
  if (card) {
    return (
      <button type="button" aria-label={`Open ${cardLabel(card)}`} data-testid="log-thumb" onClick={(ev) => { ev.stopPropagation(); openCard(card, m); }}
        style={{width: 38, flex: 'none', padding: 0, background: 'none', containerType: 'inline-size', borderRadius: 4, alignSelf: 'flex-start'}}>
        <CardFace card={cardDef(card)} variant="thumb" />
      </button>
    );
  }
  const what = m.how === 'milestone' ? 'milestone' : m.how === 'award' ? 'award' : /plants/i.test(m.head.data[1]?.value ?? '') ? 'plants' : /heat/i.test(m.head.data[1]?.value ?? '') ? 'heat' : 'other';
  return (
    <span aria-hidden="true" style={{width: 38, height: 38, flex: 'none', borderRadius: 10, display: 'grid', placeItems: 'center', alignSelf: 'flex-start',
      background: `color-mix(in oklab, ${hex(m.by)} 16%, #2A1712)`, boxShadow: `inset 0 0 0 1.5px color-mix(in oklab, ${hex(m.by)} 45%, transparent)`}}>
      {what === 'plants' && <ResIcon r="plants" size={22} />}
      {what === 'heat' && <ResIcon r="heat" size={22} />}
      {what === 'milestone' && (
        <svg width="20" height="20" viewBox="0 0 24 24"><path d="M6 21V4M6 4h11l-2.5 4L17 12H6" fill="none" stroke="var(--mc)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" /></svg>
      )}
      {what === 'award' && (
        <svg width="20" height="20" viewBox="0 0 24 24"><path d="M7 4h10v4a5 5 0 0 1-10 0Z M12 13v4M8 20h8M7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4" fill="none" stroke="var(--mc)" strokeWidth="1.9" strokeLinejoin="round" strokeLinecap="round" /></svg>
      )}
      {what === 'other' && <span style={{width: 10, height: 10, borderRadius: 3, background: hex(m.by)}} />}
    </span>
  );
}

function MoveRow({m, expanded, onToggle}: {m: Move; expanded: boolean; onToggle: (key: string) => void}) {
  const nameOf = useNameOf();
  const {openCard, tv} = useContext(LogCtx);
  const phrases = useMemo(() => summary(m), [m]);
  const lines = useMemo(() => shownLines(m.lines, m.by), [m]);
  const more = Math.max(0, phrases.length - SUMMARY_MAX);
  const text = phrases.slice(0, SUMMARY_MAX).map((p) => plain(p, nameOf)).join(' · ') + (more ? ` · and ${more} more` : '');
  // with a TV at the table, every move it can show opens to its TV buttons
  const linked = useMemo(() => tv && (replayable(m) || echoTargets(m).length > 0), [tv, m]);
  const canExpand = lines.length > 0 || linked;
  const card = m.card && showable(m.card) ? m.card : null;
  const hit = useMemo(() => m.lines.some((l) => victimOf(l, m.by)), [m]);
  const tap = () => { if (canExpand) onToggle(m.key); else if (card) openCard(card, m); };
  return (
    <div data-testid="log-move" data-expanded={expanded || undefined} role="button" tabIndex={0} aria-expanded={canExpand ? expanded : undefined}
      onClick={tap} onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); tap(); } }}
      style={{position: 'relative', display: 'flex', gap: 10, padding: '9px 10px 9px 12px', borderRadius: 14, cursor: canExpand || card ? 'pointer' : 'default',
        background: expanded ? 'rgba(255,255,255,.065)' : 'rgba(255,255,255,.035)', boxShadow: 'inset 0 0 0 1px var(--rim)', overflow: 'hidden'}}>
      <span aria-hidden="true" style={{position: 'absolute', left: 0, top: 0, bottom: 0, width: 3.5, background: hex(m.by)}} />
      <MoveThumb m={m} />
      <div style={{flex: 1, minWidth: 0}}>
        <div style={{fontSize: 14.5, lineHeight: 1.3, fontWeight: 520}}><Segs segs={headline(m)} move={m} /></div>
        {!expanded && text && (
          <div data-testid="log-summary" style={{display: 'flex', alignItems: 'center', gap: 4, fontSize: 12.5, lineHeight: 1.3, marginTop: 2, color: 'var(--ice-dim)'}}>
            {hit && <Bolt size={13} />}
            <span style={{minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>{text}</span>
          </div>
        )}
        {expanded && (
          <ul data-testid="log-move-lines" style={{listStyle: 'none', margin: '6px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 4}}>
            {lines.map((l, i) => <DetailLine key={i} line={l} move={m} />)}
          </ul>
        )}
        {expanded && linked && <MoveTvLinks m={m} style={{marginTop: 8}} />}
      </div>
      {canExpand && (
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14" style={{flex: 'none', marginTop: 4, color: 'var(--ice-faint)', transform: expanded ? 'rotate(180deg)' : undefined}}>
          <path d="M3 5l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </div>
  );
}

/** One line of what a move caused, in the engine's words, with a dot in the colour of the player it is about. */
function DetailLine({line, move, current}: {line: LogLine; move: Move | null; current?: string}) {
  const segs = segments(line);
  const {me} = useContext(LogCtx);
  // the seat's private lines ("You drew …") name no player: they are the seat's
  const who = (segs.find((s) => s.t === 'player') as {color: Color} | undefined)?.color ?? (segs[0]?.t === 'text' && /^You /.test(segs[0].v) ? me : null);
  const victim = move ? victimOf(line, move.by) : null;
  return (
    <li data-hit={victim ? true : undefined} style={{display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 13.5, lineHeight: 1.35, color: 'var(--ice)'}}>
      {victim
        ? <span style={{width: 6, flex: 'none', display: 'grid', placeItems: 'center', transform: 'translateY(2px)'}}><Bolt size={13} /></span>
        : <span aria-hidden="true" style={{width: 6, height: 6, borderRadius: 2, flex: 'none', background: who ? hex(who) : 'var(--ice-faint)', transform: 'translateY(-1px)'}} />}
      <span style={{minWidth: 0}}><Segs segs={segs} move={move} current={current} /></span>
    </li>
  );
}

/** A hit on another player: the same bolt the notices use. */
function Bolt({size}: {size: number}) {
  return (
    <svg aria-label="hit" width={size} height={size} viewBox="0 0 24 24" style={{flex: 'none'}}>
      <path d="M13.5 2 5 13.5h6L9.5 22 19 9.5h-6.2Z" fill="var(--ember)" />
    </svg>
  );
}

function ResearchRow({lines}: {lines: LogLine[]}) {
  const {me} = useContext(LogCtx);
  const shown = shownLines(lines, me);
  return (
    <div data-testid="log-research" style={{display: 'flex', gap: 10, padding: '8px 12px', borderRadius: 12, background: 'rgba(255,255,255,.02)'}}>
      <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" style={{flex: 'none', marginTop: 1, color: 'var(--tr)'}}>
        <rect x="4" y="5" width="11" height="15" rx="2" fill="none" stroke="currentColor" strokeWidth="1.9" transform="rotate(-8 9.5 12.5)" />
        <rect x="9" y="4" width="11" height="15" rx="2" fill="#24130F" stroke="currentColor" strokeWidth="1.9" transform="rotate(7 14.5 11.5)" />
      </svg>
      <div style={{fontSize: 13.5, lineHeight: 1.4, color: 'var(--ice-dim)', minWidth: 0}}>
        <span style={{color: 'var(--ice)', fontWeight: 650}}>Research</span>
        {shown.map((l, i) => <span key={i}>{i ? ' · ' : ': '}<Segs segs={segments(l)} move={null} /></span>)}
      </div>
    </div>
  );
}

function LineRow({line, by}: {line: LogLine; by: Color | null}) {
  const quiet = /^\$\{0\} (passed|ended turn)$/.test(line.message);
  return (
    <div data-testid="log-line" style={{display: 'flex', gap: 10, alignItems: 'baseline', padding: quiet ? '3px 12px' : '7px 12px', fontSize: quiet ? 13 : 14,
      lineHeight: 1.35, color: quiet ? 'var(--ice-faint)' : 'var(--ice-dim)'}}>
      <span aria-hidden="true" style={{width: 7, height: 7, borderRadius: 2, flex: 'none', background: hex(by), opacity: quiet ? 0.6 : 1}} />
      <span style={{minWidth: 0}}><Segs segs={segments(line)} move={null} /></span>
    </div>
  );
}

function RunRow({k, lines, expanded, onToggle}: {k: string; lines: LogLine[]; expanded: boolean; onToggle: (key: string) => void}) {
  const shown = expanded ? lines : lines.slice(-1);
  return (
    <div data-testid="log-run">
      {/* newest first, like the list */}
      {[...shown].reverse().map((l, i) => <LineRow key={i} line={l} by={(l.data[0]?.type === 2 ? l.data[0].value : null) as Color | null} />)}
      <button type="button" onClick={() => onToggle(k)} data-testid="log-run-toggle"
        style={{margin: '2px 0 0 29px', padding: '4px 10px', borderRadius: 999, fontSize: 12.5, fontWeight: 650, background: 'rgba(255,255,255,.06)', color: 'var(--ice-dim)'}}>
        {expanded ? 'Show fewer' : `${lines.length - 1} more ${lines.length - 1 === 1 ? 'line' : 'lines'}`}
      </button>
    </div>
  );
}

// ---- the card with what happened --------------------------------------------------------------------------------------
type ViewerState = {cards: string[]; index: number; move: Move | null};

function MoveViewer({viewer, entries, model, onChange}: {viewer: ViewerState | null; entries: LogEntry[]; model: PlayerViewModel; onChange: (v: ViewerState | null) => void}) {
  const name = viewer ? viewer.cards[viewer.index] : null;
  const onTable = name ? cardOnTable(model, name) : null;
  return (
    <CardViewer card={name ? cardDef(name) : null} resources={onTable?.resources || undefined} onClose={() => onChange(null)} backLabel="Close"
      nav={viewer && viewer.cards.length > 1 ? {index: viewer.index, count: viewer.cards.length,
        go: (d) => onChange({...viewer, index: Math.max(0, Math.min(viewer.cards.length - 1, viewer.index + d))}),
        peek: (d) => { const n = viewer.cards[viewer.index + d]; return n ? {card: cardDef(n), resources: cardOnTable(model, n)?.resources || undefined} : null; }} : undefined}>
      {name && viewer ? () => <WhatHappened name={name} viewer={viewer} entries={entries} model={model} onChange={onChange} /> : undefined}
    </CardViewer>
  );
}

/** Where a card is now: whose table, its resources, and whether its action was used this generation. */
function cardOnTable(model: PlayerViewModel, name: string): {owner: Color; resources: number; used: boolean} | null {
  for (const p of model.players) {
    const c = p.tableau.find((x) => x.name === name);
    if (c) return {owner: p.color, resources: c.resources ?? 0, used: (p.actionsThisGeneration ?? []).includes(name)};
  }
  return null;
}

function WhatHappened({name, viewer, entries, model, onChange}: {name: string; viewer: ViewerState; entries: LogEntry[]; model: PlayerViewModel; onChange: (v: ViewerState | null) => void}) {
  const {names, me} = useContext(LogCtx);
  const m = viewer.move;
  const lines = m ? shownLines(m.lines, m.by) : [];
  const def = findCard(name);
  const table = cardOnTable(model, name);
  const inHand = model.cardsInHand.some((c) => c.name === name);
  const hasAction = !!def && (def.text ?? []).some((t) => /^Action:/i.test(t));
  const others = movesWithCard(entries, name).filter((x) => x.key !== m?.key).reverse().slice(0, 4);
  const who = (c: Color) => <span style={{color: hex(c), fontWeight: 680}}>{c === me ? 'You' : names[c] ?? c}</span>;
  const whose = (c: Color) => (c === me ? 'your' : `${names[c] ?? c}’s`);
  const state: ReactNode[] = [];
  if (table) {
    const ev = def?.type === 'event';
    state.push(<span key="where">{ev ? <>An event {table.owner === me ? 'you' : who(table.owner)} played</> : <>On {table.owner === me ? 'your' : <>{who(table.owner)}’s</>} table</>}</span>);
    // its resources now show on the card itself (the facts row under the rules)
    if (hasAction) state.push(<span key="act">{table.used ? 'Action used this generation' : 'Action not used yet this generation'}</span>);
  } else if (inHand) state.push(<span key="hand">In your hand</span>);
  return (
    <div data-testid="what-happened" style={{textAlign: 'left'}}>
      {state.length > 0 && (
        <div data-testid="card-state" style={{display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12}}>
          {state.map((s, i) => (
            <span key={i} style={{fontSize: 12.5, padding: '4px 10px', borderRadius: 999, background: 'rgba(255,255,255,.06)', color: 'var(--ice-dim)'}}>{s}</span>
          ))}
        </div>
      )}
      {m && (
        <>
          <h3 className="cond" style={{margin: '0 0 6px', fontSize: 16, fontWeight: 700, color: 'var(--ice)'}}>What happened</h3>
          <div style={{display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 14.5, lineHeight: 1.35}}>
            <span aria-hidden="true" style={{width: 8, height: 8, borderRadius: 2, flex: 'none', background: hex(m.by), transform: 'translateY(-1px)'}} />
            <span><Segs segs={headline(m)} move={m} current={name} />{m.generation ? <span className="faint" style={{fontSize: 12.5, whiteSpace: 'nowrap'}}> · generation {m.generation}</span> : null}</span>
          </div>
          <MoveTvLinks m={m} style={{margin: '8px 0 0 16px'}} />
          {lines.length > 0 ? (
            <ul style={{listStyle: 'none', margin: '8px 0 0 16px', padding: 0, display: 'flex', flexDirection: 'column', gap: 5}}>
              {lines.map((l, i) => <DetailLine key={i} line={l} move={m} current={name} />)}
            </ul>
          ) : (
            <p className="faint" style={{margin: '6px 0 0 16px', fontSize: 13}}>The log shows nothing else for this move.</p>
          )}
          {m.card !== name && m.card && (
            <p className="faint" style={{margin: '8px 0 0 16px', fontSize: 12.5}}>{cardLabel(name)} came up in {whose(m.by)} {cardLabel(m.card)} move.</p>
          )}
        </>
      )}
      {others.length > 0 && (
        <div style={{marginTop: 14}}>
          <h3 className="cond" style={{margin: '0 0 4px', fontSize: 14.5, fontWeight: 700, color: 'var(--ice-dim)'}}>Also in the log</h3>
          <div style={{display: 'flex', flexDirection: 'column', gap: 4}}>
            {others.map((o) => (
              <button key={o.key} type="button" data-testid="also-move" onClick={() => onChange({...viewer, move: o})}
                style={{textAlign: 'left', padding: '7px 10px', borderRadius: 10, background: 'rgba(255,255,255,.04)', color: 'var(--ice)', fontSize: 13.5, lineHeight: 1.3}}>
                <Segs segs={headline(o)} move={o} cards={false} />
                {o.generation ? <span className="faint" style={{fontSize: 12, whiteSpace: 'nowrap'}}> · generation {o.generation}</span> : null}
                {o.lines.length > 0 && <div style={{fontSize: 12, color: 'var(--ice-dim)', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>
                  {summary(o).map((p) => plain(p, (c) => (c === me ? 'you' : names[c] ?? c))).join(' · ')}</div>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
