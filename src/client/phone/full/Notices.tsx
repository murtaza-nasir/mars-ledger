// Table sense on the phone: what happened to this player, as it happens.
//   - hits (another player took from you) arrive as a toast, then stay under the header, in the attacker's colour, until
//     cleared; the phone buzzes when the TV shows the hit landing (or at once with no TV: src/shared/tvlinks.ts)
//   - cards in or out of your hand and gifts from others' moves rise as a toast for about 6 s; several at once group
//   - the bell in the header opens every notice of this game, newest first; a row opens the cards it involves
// The layer reads its own slice of the store, so a notice never re-renders the hand or the deck. With a decision
// sheet open, everything at the top folds into one 36 px pill above the sheet, clear of its answers.
import {AnimatePresence, motion, useReducedMotion} from 'motion/react';
import {memo, useEffect, useMemo, useRef, useState} from 'react';
import {create} from 'zustand';
import type {Color} from '../../../shared/full';
import {cardLabel, changeText, groupTitle, noticeText} from '../../../shared/notices';
import type {Notice} from '../../../shared/notices';
import {useNet} from '../../net';
import {PLAYER_HEX} from '../../ui/Icons';
import {CardFace} from '../../ui/CardFace';
import {Sheet} from '../../ui/Sheet';
import {CardViewer} from '../../ui/deck/Viewer';
import {useViewerCovered} from '../../ui/deck/cover';
import {cardDef} from './model';

/** A toast stays this long once it is on screen. */
export const TOAST_MS = 6000;
/** Hits shown in full at the top before the rest fold into "N more". */
const STACK_MAX = 2;

const useNoticeUi = create<{feed: boolean; viewer: {cards: string[]; index: number} | null}>(() => ({feed: false, viewer: null}));
const openFeed = () => useNoticeUi.setState({feed: true});
const openCards = (cards: string[], index = 0) => { if (cards.length) useNoticeUi.setState({viewer: {cards, index}}); };

const colorOf = (c: Color | null | undefined) => (c ? PLAYER_HEX[c as keyof typeof PLAYER_HEX] ?? 'var(--ember)' : 'var(--ember)');

/** Every card a notice involves: cards that came in or left, the card that caused it, the seat's cards that changed. */
export function cardsOf(n: Notice): string[] {
  const out = [...(n.cardsIn ?? []), ...(n.cardsOut ?? [])];
  if (n.cause && n.cause.how !== 'project' && n.cause.how !== 'standard') out.push(n.cause.card);
  for (const c of n.changes) if (c.card) out.push(c.card);
  return [...new Set(out)];
}

// ---- the bell in the header -----------------------------------------------------------------------------------------
export function NoticeBell() {
  // only the count re-renders the bell
  const unread = useNet((s) => (s.notices ? s.notices.notices.filter((n) => n.at > s.notices!.seenAt).length : 0));
  const hits = useNet((s) => (s.notices ? s.notices.notices.some((n) => n.kind === 'hit' && n.at > s.notices!.seenAt) : false));
  return (
    <button aria-label={unread ? `What happened to you: ${unread} new` : 'What happened to you'} data-testid="notice-bell" onClick={openFeed}
      style={{position: 'relative', width: 40, height: 40, flex: 'none', borderRadius: 12, display: 'grid', placeItems: 'center', background: 'rgba(255,255,255,.06)', color: 'var(--ice)'}}>
      <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.6 2H4.4Z" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" />
        <path d="M10 21h4" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      </svg>
      {unread > 0 && (
        <span className="num" data-testid="notice-unread"
          style={{position: 'absolute', top: -4, right: -4, minWidth: 19, height: 19, padding: '0 5px', borderRadius: 10, display: 'grid', placeItems: 'center',
            fontSize: 11.5, fontWeight: 750, background: hits ? 'var(--ember)' : 'var(--tr)', color: hits ? '#FFF4EE' : '#08202E', boxShadow: '0 0 0 2px var(--dusk-1)'}}>
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </button>
  );
}

// ---- the layer ------------------------------------------------------------------------------------------------------
/**
 * Mounted once on the seated phone, fixed at the top edge: the toast for whatever just arrived (hits too, so a hit is
 * seen the moment it lands wherever the page is scrolled), the feed and the card view. `decision`: a decision sheet is
 * open, and the toast folds into a 36 px pill above it.
 */
export const NoticeLayer = memo(function NoticeLayer({playerId, decision}: {playerId: string; decision: boolean}) {
  const feed = useNet((s) => s.notices);
  const fresh = useNet((s) => s.noticeFresh);
  const away = useNet((s) => !!s.away);
  const covered = useViewerCovered();
  const reduce = useReducedMotion();
  const notices = useMemo(() => (feed && feed.playerId === playerId ? feed.notices : []), [feed, playerId]);

  // One toast; more arriving while it shows join it (its timer restarts).
  const [toast, setToast] = useState<{key: number; ids: string[]; at: number} | null>(null);
  const lastSeq = useRef(fresh.seq);
  useEffect(() => {
    if (fresh.seq === lastSeq.current) return;
    lastSeq.current = fresh.seq;
    const byId = new Map(notices.map((n) => [n.id, n]));
    const arrived = fresh.ids.filter((id) => byId.has(id));
    // a hit's buzz comes from the server (hapticHit, src/client/net.ts), timed to the moment the TV shows it landing
    if (arrived.length) setToast((t) => (t ? {key: t.key, ids: [...t.ids, ...arrived], at: Date.now()} : {key: Date.now(), ids: arrived, at: Date.now()}));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fresh.seq]);
  // the toast's time runs only while it can be seen (not under the away card or the lifted card view)
  const blocked = away || covered;
  useEffect(() => {
    if (!toast || blocked) return;
    const t = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(t);
  }, [toast, blocked]);
  const toastNotices = useMemo(() => {
    if (!toast) return [];
    const ids = new Set(toast.ids);
    // newest first, as everywhere; an undone notice drops out of its toast
    return notices.filter((n) => ids.has(n.id));
  }, [toast, notices]);
  useEffect(() => { if (toast && !toastNotices.length) setToast(null); }, [toast, toastNotices.length]);

  const clearNotices = useNet((s) => s.clearNotices);
  const clear = (ids?: string[]) => { navigator.vibrate?.(8); clearNotices(playerId, ids); };
  const showToast = !!toast && toastNotices.length > 0 && !blocked;

  return (
    <>
      <div data-testid="notice-layer" style={{position: 'fixed', zIndex: 58, left: 10, right: 10, top: `calc(${decision ? 4 : 8}px + env(safe-area-inset-top))`,
        maxWidth: 520, margin: '0 auto', display: 'flex', flexDirection: 'column', pointerEvents: 'none'}}>
        <AnimatePresence initial={false}>
          {showToast && (decision
            ? <Pill key={`pill-${toast!.key}`} ns={toastNotices} />
            : <Toast key={`toast-${toast!.key}`} ns={toastNotices} since={toast!.at} reduce={!!reduce} onClose={() => setToast(null)} />)}
        </AnimatePresence>
      </div>
      <Feed playerId={playerId} notices={notices} onClear={clear} />
      <NoticeViewer />
    </>
  );
});

// ---- hits that stay: in the page under the header, so they never cover its buttons ----------------------------------
/** Uncleared hits, newest first, between the header and the tabs. They stay until cleared, across reloads and phones. */
export const HitStack = memo(function HitStack({playerId}: {playerId: string}) {
  const feed = useNet((s) => s.notices);
  const hits = useMemo(() => (feed && feed.playerId === playerId ? feed.notices.filter((n) => n.kind === 'hit' && !n.cleared) : NONE), [feed, playerId]);
  const clearNotices = useNet((s) => s.clearNotices);
  const reduce = useReducedMotion();
  const clear = (ids: string[]) => { navigator.vibrate?.(8); clearNotices(playerId, ids); };
  return (
    <div data-testid="hit-stack" style={{display: 'flex', flexDirection: 'column', gap: 6, padding: hits.length ? '2px 16px 8px' : 0}}>
      <AnimatePresence initial={false}>
        {hits.slice(0, STACK_MAX).map((n) => <HitRow key={n.id} n={n} reduce={!!reduce} onClear={() => clear([n.id])} />)}
        {hits.length > 1 && (
          <motion.div key="hits-foot" layout={!reduce} initial={{opacity: 0}} animate={{opacity: 1}} exit={{opacity: 0}}
            style={{display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8}}>
            {hits.length > STACK_MAX && (
              <button onClick={openFeed} data-testid="hits-more"
                style={{height: 30, padding: '0 12px', borderRadius: 999, fontSize: 13, fontWeight: 650, background: 'rgba(255,255,255,.06)', color: 'var(--ice-dim)'}}>
                {hits.length - STACK_MAX} more
              </button>
            )}
            <button onClick={() => clear(hits.map((n) => n.id))} data-testid="hits-clear-all"
              style={{height: 30, padding: '0 12px', borderRadius: 999, fontSize: 13, fontWeight: 700, background: 'rgba(255,255,255,.09)', color: 'var(--ice)'}}>
              Clear all
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}, (a, b) => a.playerId === b.playerId);
const NONE: Notice[] = [];

// ---- pieces ---------------------------------------------------------------------------------------------------------
function KindIcon({kind, color, size = 18}: {kind: Notice['kind']; color: string; size?: number}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{flex: 'none'}}>
      {kind === 'hit' && <path d="M13.5 2 5 13.5h6L9.5 22 19 9.5h-6.2Z" fill={color} />}
      {kind === 'gift' && <path d="M12 5v14M5 12h14" stroke={color} strokeWidth="2.6" strokeLinecap="round" />}
      {kind === 'cards' && (
        <>
          <rect x="4" y="5" width="11" height="15" rx="2" fill="none" stroke={color} strokeWidth="1.9" transform="rotate(-8 9.5 12.5)" />
          <rect x="9" y="4" width="11" height="15" rx="2" fill="rgba(20,10,8,.9)" stroke={color} strokeWidth="1.9" transform="rotate(7 14.5 11.5)" />
        </>
      )}
    </svg>
  );
}

function HitRow({n, reduce, onClear}: {n: Notice; reduce: boolean; onClear: () => void}) {
  const {title, detail} = noticeText(n);
  const c = colorOf(n.by);
  const cards = cardsOf(n);
  return (
    <motion.div layout={!reduce} data-testid="hit-row" role="alert"
      initial={reduce ? {opacity: 0} : {opacity: 0, y: -24}} animate={{opacity: 1, y: 0}} exit={reduce ? {opacity: 0} : {opacity: 0, x: 60, transition: {duration: 0.18}}}
      transition={{type: 'spring', stiffness: 420, damping: 32}}
      style={{pointerEvents: 'auto', display: 'flex', alignItems: 'center', gap: 10, padding: '8px 8px 8px 12px', borderRadius: 14, overflow: 'hidden',
        background: `linear-gradient(90deg, color-mix(in oklab, ${c} 26%, #1E0E0A) 0%, #1E0E0A 46%)`,
        boxShadow: `inset 0 0 0 1.5px color-mix(in oklab, ${c} 70%, transparent), 0 8px 22px rgba(0,0,0,.45)`}}>
      <span style={{alignSelf: 'stretch', width: 4, borderRadius: 2, background: c, flex: 'none', marginLeft: -4}} />
      {/* the bolt stays ember (a hit, whatever the attacker's colour); the stripe and rim carry the attacker */}
      <KindIcon kind="hit" color="var(--ember)" />
      <button onClick={() => (cards.length ? openCards(cards) : openFeed())} style={{flex: 1, minWidth: 0, textAlign: 'left', padding: 0, background: 'none', color: 'var(--ice)'}}>
        <div style={{fontWeight: 700, fontSize: 14.5, lineHeight: 1.25}}>{title}</div>
        {detail && <div style={{fontSize: 12.5, color: 'var(--ice-dim)', marginTop: 1, lineHeight: 1.25}}>{detail}</div>}
      </button>
      <button onClick={onClear} data-testid="hit-clear" aria-label={`Clear: ${title}`}
        style={{flex: 'none', height: 32, padding: '0 12px', borderRadius: 999, fontSize: 13, fontWeight: 700, background: 'rgba(255,255,255,.09)', color: 'var(--ice)'}}>
        Clear
      </button>
    </motion.div>
  );
}

function Thumbs({names, max = 5, size = 46}: {names: string[]; max?: number; size?: number}) {
  return (
    <div style={{display: 'flex', gap: 6, alignItems: 'flex-end'}}>
      {names.slice(0, max).map((name, i) => (
        <button key={name} aria-label={`Open ${cardLabel(name)}`} data-testid="notice-card"
          onClick={(e) => { e.stopPropagation(); openCards(names, i); }}
          style={{width: size, flex: 'none', padding: 0, background: 'none', containerType: 'inline-size', borderRadius: 4}}>
          {/* the thumb is sized in cqw: this button is its container */}
          <CardFace card={cardDef(name)} variant="thumb" />
        </button>
      ))}
      {names.length > max && <span className="num" style={{fontSize: 13, color: 'var(--ice-dim)', paddingBottom: 6}}>+{names.length - max}</span>}
    </div>
  );
}

const ACCENT: Record<Notice['kind'], string> = {hit: 'var(--ember)', gift: 'var(--plants)', cards: 'var(--tr)'};

function Toast({ns, since, reduce, onClose}: {ns: Notice[]; since: number; reduce: boolean; onClose: () => void}) {
  const cardsIn = ns.flatMap((n) => n.cardsIn ?? []);
  const single = ns.length === 1 ? noticeText(ns[0]) : null;
  const title = groupTitle(ns);
  // the detail of one notice; for a group, each notice's own line (unless the headline already says it all: draws)
  const allDraws = ns.every((n) => n.kind === 'cards' && !(n.cardsOut ?? []).length);
  const lines = single ? (single.detail ? [single.detail] : []) : allDraws ? [] : [...ns.slice(0, 3).map((n) => noticeText(n).title), ...(ns.length > 3 ? [`and ${ns.length - 3} more`] : [])];
  const kind = ns.every((n) => n.kind === 'cards') ? 'cards' : ns.some((n) => n.kind === 'hit') ? 'hit' : ns[0].kind;
  const accent = kind === 'hit' ? colorOf(ns.find((n) => n.kind === 'hit')!.by) : ACCENT[kind];
  const by = ns.find((n) => n.by)?.by;
  const all = [...new Set(ns.flatMap(cardsOf))];
  return (
    <motion.div layout={!reduce} data-testid="notice-toast" role="status" aria-live="polite"
      initial={reduce ? {opacity: 0} : {opacity: 0, y: -20, scale: 0.97}} animate={{opacity: 1, y: 0, scale: 1}}
      exit={reduce ? {opacity: 0} : {opacity: 0, y: -16, transition: {duration: 0.2}}} transition={{type: 'spring', stiffness: 380, damping: 30}}
      onClick={() => (all.length ? openCards(cardsIn.length ? cardsIn : all) : openFeed())}
      style={{pointerEvents: 'auto', position: 'relative', overflow: 'hidden', cursor: 'pointer', padding: '10px 12px 12px', borderRadius: 16,
        background: 'linear-gradient(180deg, rgba(44,26,20,.98), rgba(30,17,13,.98))',
        boxShadow: `inset 0 0 0 1.5px color-mix(in oklab, ${accent} 55%, transparent), 0 10px 26px rgba(0,0,0,.5)`}}>
      <div style={{display: 'flex', alignItems: 'flex-start', gap: 10}}>
        <KindIcon kind={kind} color={kind === 'hit' ? 'var(--ember)' : accent} size={20} />
        <div style={{flex: 1, minWidth: 0}}>
          <div style={{fontWeight: 720, fontSize: 15, lineHeight: 1.25}}>{title}</div>
          {lines.map((l, i) => (
            <div key={i} style={{fontSize: 12.5, color: 'var(--ice-dim)', marginTop: 1, lineHeight: 1.3, display: 'flex', alignItems: 'center', gap: 6}}>
              {i === 0 && by && <span style={{width: 8, height: 8, borderRadius: 2, background: colorOf(by), flex: 'none'}} />}{l}
            </div>
          ))}
        </div>
        <button aria-label="Dismiss" onClick={(e) => { e.stopPropagation(); onClose(); }}
          style={{flex: 'none', width: 28, height: 28, marginTop: -4, marginRight: -4, borderRadius: 14, display: 'grid', placeItems: 'center', background: 'none', color: 'var(--ice-faint)'}}>
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
        </button>
      </div>
      {cardsIn.length > 0 && <div style={{marginTop: 9, paddingLeft: 30}}><Thumbs names={cardsIn} /></div>}
      {/* the time left, as a thin bar along the bottom edge */}
      <motion.div key={since} initial={{scaleX: 1}} animate={{scaleX: 0}} transition={{duration: TOAST_MS / 1000, ease: 'linear'}}
        style={{position: 'absolute', left: 0, right: 0, bottom: 0, height: 2.5, transformOrigin: 'left', background: accent, opacity: 0.6}} />
    </motion.div>
  );
}

/** Over an open decision: one line, 36 px, above the sheet and clear of its answers. */
function Pill({ns}: {ns: Notice[]}) {
  const kind = ns.every((x) => x.kind === 'cards') ? 'cards' : ns.some((x) => x.kind === 'hit') ? 'hit' : ns[0].kind;
  const c = kind === 'hit' ? colorOf(ns.find((x) => x.kind === 'hit')!.by) : ACCENT[kind];
  return (
    <motion.button data-testid="notice-pill" onClick={openFeed}
      initial={{opacity: 0, y: -10}} animate={{opacity: 1, y: 0}} exit={{opacity: 0, y: -10}}
      style={{pointerEvents: 'auto', alignSelf: 'center', maxWidth: '100%', height: 36, display: 'flex', alignItems: 'center', gap: 8, padding: '0 14px 0 10px', borderRadius: 999,
        background: 'rgba(30,14,10,.97)', color: 'var(--ice)', boxShadow: `inset 0 0 0 1.5px ${c}, 0 6px 18px rgba(0,0,0,.45)`}}>
      <KindIcon kind={kind} color={kind === 'hit' ? 'var(--ember)' : c} size={16} />
      <span style={{fontSize: 13.5, fontWeight: 680, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>{groupTitle(ns)}</span>
    </motion.button>
  );
}

// ---- the feed -------------------------------------------------------------------------------------------------------
function ago(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  return `${Math.round(m / 60)} h ago`;
}

function Feed({playerId, notices, onClear}: {playerId: string; notices: Notice[]; onClear: (ids?: string[]) => void}) {
  const open = useNoticeUi((s) => s.feed);
  const seenNotices = useNet((s) => s.seenNotices);
  const seenAt = useNet((s) => s.notices?.seenAt ?? 0);
  // what was unread when the feed opened stays marked while it is open
  const [unreadFrom, setUnreadFrom] = useState(0);
  useEffect(() => {
    if (!open) return;
    setUnreadFrom(seenAt);
    if (notices[0] && notices[0].at > seenAt) seenNotices(playerId, notices[0].at);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const live = notices.filter((n) => n.kind === 'hit' && !n.cleared);
  const now = Date.now();
  return (
    <Sheet open={open} onClose={() => useNoticeUi.setState({feed: false})} title="What happened to you" tall
      aside={live.length ? <button onClick={() => onClear(live.map((n) => n.id))} style={{height: 32, padding: '0 12px', borderRadius: 999, fontSize: 13, fontWeight: 700, background: 'rgba(255,255,255,.08)', color: 'var(--ice)'}}>Clear all hits</button> : undefined}>
      {!notices.length && <p className="muted" style={{margin: '8px 0 20px'}}>Nothing has happened to you yet. When another player takes from you, gives you something, or cards come into your hand, it shows up here.</p>}
      <div data-testid="notice-feed" style={{display: 'flex', flexDirection: 'column', gap: 8}}>
        {notices.map((n, i) => {
          const {title, detail} = noticeText(n);
          const cards = cardsOf(n);
          const c = n.kind === 'hit' ? colorOf(n.by) : ACCENT[n.kind];
          const newGen = i === 0 || notices[i - 1].generation !== n.generation;
          return (
            <div key={n.id}>
              {newGen && <div className="cond faint" style={{fontSize: 12, letterSpacing: '.06em', textTransform: 'uppercase', margin: i ? '10px 2px 6px' : '0 2px 6px'}}>Generation {n.generation}</div>}
              <div data-testid="notice-row" role="button" tabIndex={0} onClick={() => openCards(cards)}
                style={{display: 'flex', gap: 10, padding: '10px 12px', borderRadius: 14, cursor: cards.length ? 'pointer' : 'default',
                  background: n.at > unreadFrom ? 'rgba(255,255,255,.07)' : 'rgba(255,255,255,.035)',
                  boxShadow: n.kind === 'hit' && !n.cleared ? `inset 0 0 0 1.5px color-mix(in oklab, ${c} 65%, transparent)` : 'inset 0 0 0 1px var(--rim)'}}>
                <div style={{paddingTop: 1}}><KindIcon kind={n.kind} color={n.kind === 'hit' ? 'var(--ember)' : c} /></div>
                <div style={{flex: 1, minWidth: 0}}>
                  <div style={{fontWeight: 680, fontSize: 14.5, lineHeight: 1.3}}>{title}</div>
                  {detail && <div style={{fontSize: 12.5, color: 'var(--ice-dim)', lineHeight: 1.3, marginTop: 1}}>{detail}</div>}
                  {n.kind === 'gift' && n.changes.length > 3 && <div style={{fontSize: 12.5, color: 'var(--ice-dim)'}}>{n.changes.map((x) => changeText(x, {yours: true})).join(', ')}</div>}
                  {(n.cardsIn?.length || n.cardsOut?.length) ? (
                    <div style={{display: 'flex', gap: 14, marginTop: 8, flexWrap: 'wrap'}}>
                      {!!n.cardsIn?.length && <Thumbs names={n.cardsIn} max={6} size={42} />}
                      {!!n.cardsOut?.length && (
                        <div style={{opacity: 0.7}}>
                          <div className="faint" style={{fontSize: 11.5, marginBottom: 3}}>Left your hand</div>
                          <Thumbs names={n.cardsOut} max={4} size={42} />
                        </div>
                      )}
                    </div>
                  ) : null}
                  <div className="faint" style={{fontSize: 11.5, marginTop: 4}}>{ago(n.at, now)}{n.kind === 'hit' && n.cleared ? ' · cleared' : ''}</div>
                </div>
                {n.kind === 'hit' && !n.cleared && (
                  <button onClick={(e) => { e.stopPropagation(); onClear([n.id]); }}
                    style={{alignSelf: 'flex-start', height: 30, padding: '0 11px', borderRadius: 999, fontSize: 12.5, fontWeight: 700, background: 'rgba(255,255,255,.08)', color: 'var(--ice)'}}>Clear</button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Sheet>
  );
}

/** The existing lifted card view, for the cards of a notice (swipe or arrows move along them). */
function NoticeViewer() {
  const v = useNoticeUi((s) => s.viewer);
  const close = () => useNoticeUi.setState({viewer: null});
  const name = v ? v.cards[v.index] : null;
  return (
    <CardViewer card={name ? cardDef(name) : null} onClose={close} backLabel="Close"
      nav={v && v.cards.length > 1 ? {index: v.index, count: v.cards.length,
        go: (d) => useNoticeUi.setState((s) => (s.viewer ? {viewer: {...s.viewer, index: Math.max(0, Math.min(s.viewer.cards.length - 1, s.viewer.index + d))}} : {})),
        peek: (d) => { const n = v.cards[v.index + d]; return n ? {card: cardDef(n)} : null; }} : undefined} />
  );
}
