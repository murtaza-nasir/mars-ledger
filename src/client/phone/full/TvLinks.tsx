// Phone-to-TV links on the phone (src/shared/tvlinks.ts):
//   - "Replay on the TV" and "Show on the TV" under a log move: the TV presents the move again, or pulses the spaces and
//     trackers it changed
//   - "Show last move on the TV": the same replay for the newest move, from the dock and the game menu
//   - "On the TV now": a small pill while the TV presents a card this player just played (the phone stays usable)
// Every press answers on the button itself: sent, or the server's reason (a replay on its way, the cooldown, no TV).
import {AnimatePresence, motion} from 'motion/react';
import {useEffect, useMemo, useRef, useState} from 'react';
import type {Color, LogLine} from '../../../shared/full';
import {useNet} from '../../net';
import {PLAYER_HEX} from '../../ui/Icons';
import {useLogHistory} from './logHistory';
import {cardLabel, groupLog, headline, plain} from './logMoves';
import type {LogEntry} from './logMoves';
import {echoTargets, lastReplayable, replayable, replayOf} from './logLinks';
import {useSeatNames} from '../../names';

type Move = Extract<LogEntry, {kind: 'move'}>;
type SendState = {kind: 'idle'} | {kind: 'busy'} | {kind: 'sent'} | {kind: 'error'; text: string};

const NO_LOGS: LogLine[] = [];
/** The seat this phone plays (null on the TV and before the first view). */
const useSeat = () => useNet((s) => (s.fullView?.role === 'player' ? s.fullView.playerId : null));
/** Colour → the seat's current name (src/client/names.ts). */
const useNames = (): Record<string, string> => {
  const seats = useSeatNames().byColor;
  const sig = useNet((s) => s.fullView?.model.players.map((p) => `${p.color}\u0000${p.name}`).join('\u0001') ?? '');
  return useMemo(() => ({...Object.fromEntries(sig.split('\u0001').filter(Boolean).map((x) => x.split('\u0000') as [string, string])), ...seats}), [sig, seats]);
};

/** One press at a time; the answer stays on the button for a moment. */
function useTvSend() {
  const [st, setSt] = useState<SendState>({kind: 'idle'});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const settle = (next: SendState, ms: number) => {
    setSt(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setSt({kind: 'idle'}), ms);
  };
  const run = (p: Promise<void>) => {
    setSt({kind: 'busy'});
    try { if (typeof navigator.vibrate === 'function') navigator.vibrate(8); } catch { /* not allowed */ }
    p.then(() => settle({kind: 'sent'}, 2200)).catch((e: Error) => settle({kind: 'error', text: e.message}, 3200));
  };
  return {st, run};
}

function TvGlyph({size = 16, replay}: {size?: number; replay?: boolean}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{flex: 'none'}}>
      <rect x="2.5" y="4" width="19" height="13" rx="2.2" fill="none" stroke="currentColor" strokeWidth="1.9" />
      <path d="M8 20.5h8" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      {replay
        ? <path d="M9.4 8.2a3.6 3.6 0 1 1-.6 4.1M9.4 8.2V6.1M9.4 8.2h2.1" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        : <circle cx="12" cy="10.5" r="2.4" fill="currentColor" />}
    </svg>
  );
}

const chip: React.CSSProperties = {display: 'inline-flex', alignItems: 'center', gap: 5, height: 32, padding: '0 11px 0 9px', borderRadius: 999, fontSize: 12.5, fontWeight: 650,
  background: 'rgba(255,255,255,.07)', color: 'var(--ice)', boxShadow: 'inset 0 0 0 1px var(--rim)', whiteSpace: 'nowrap'};

function label(st: SendState, idle: string): string {
  if (st.kind === 'busy') return 'Sending';
  if (st.kind === 'sent') return 'Sent to the TV';
  if (st.kind === 'error') return st.text;
  return idle;
}

/** Under a log move (expanded) and in its card view: replay it, and point at what it changed. Nothing without a TV. */
export function MoveTvLinks({m, style}: {m: Move; style?: React.CSSProperties}) {
  const seat = useSeat();
  const tvs = useNet((s) => s.tvs);
  const names = useNames();
  const targets = useMemo(() => echoTargets(m), [m]);
  const canReplay = replayable(m);
  const replay = useTvSend();
  const echo = useTvSend();
  if (!seat || tvs <= 0 || (!canReplay && !targets.length)) return null;
  const nameOf = (c: Color) => names[c] ?? c;
  return (
    <div data-testid="move-tv-links" onClick={(e) => e.stopPropagation()} style={{display: 'flex', flexWrap: 'wrap', gap: 6, ...style}}>
      {canReplay && (
        <button type="button" data-testid="log-replay" data-state={replay.st.kind} disabled={replay.st.kind === 'busy'} style={chip}
          onClick={() => replay.run(useNet.getState().askReplay(seat, replayOf(m, nameOf)))}>
          <TvGlyph size={15} replay />{label(replay.st, 'Replay on the TV')}
        </button>
      )}
      {targets.length > 0 && (
        <button type="button" data-testid="log-echo" data-state={echo.st.kind} disabled={echo.st.kind === 'busy'} style={chip}
          onClick={() => echo.run(useNet.getState().askEcho(seat, targets))}>
          <TvGlyph size={15} />{label(echo.st, 'Show on the TV')}
        </button>
      )}
    </div>
  );
}

/** The newest move in this phone's log that the TV can present again. */
export function useLastMove(): Move | null {
  const logs = useNet((s) => (s.fullView?.role === 'player' ? s.fullView.logs ?? NO_LOGS : NO_LOGS));
  const me = useNet((s) => (s.fullView?.role === 'player' ? s.fullView.model.color : null));
  const generation = useNet((s) => s.fullView?.model.game.generation ?? 0);
  const lines = useLogHistory(logs);
  return useMemo(() => (lines.length ? lastReplayable(groupLog(lines, me, generation)) : null), [lines, me, generation]);
}

/** The game menu's "Show last move on the TV", with the move it would show. */
export function LastMoveMenuItem() {
  const seat = useSeat();
  const tvs = useNet((s) => s.tvs);
  const names = useNames();
  const last = useLastMove();
  const send = useTvSend();
  if (!seat) return null;
  const nameOf = (c: Color) => names[c] ?? c;
  const what = last ? plain(headline(last), nameOf) : null;
  const sub = tvs <= 0 ? 'No TV is connected' : !last ? 'No move to show yet' : send.st.kind === 'idle' ? what! : label(send.st, '');
  return (
    <button className="btn ghost" data-testid="menu-replay-last" data-state={send.st.kind} disabled={!last || tvs <= 0 || send.st.kind === 'busy'}
      style={{justifyContent: 'space-between', gap: 12}} onClick={() => last && send.run(useNet.getState().askReplay(seat, replayOf(last, nameOf)))}>
      <span style={{display: 'inline-flex', alignItems: 'center', gap: 10, whiteSpace: 'nowrap'}}><TvGlyph size={18} replay />Show last move on the TV</span>
      <span className="faint" style={{fontSize: 13.5, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>{sub}</span>
    </button>
  );
}

/** The dock's small "Show last move on the TV" button (an icon; its answer shows as a tip above it). */
export function DockReplayButton() {
  const seat = useSeat();
  const tvs = useNet((s) => s.tvs);
  const names = useNames();
  const last = useLastMove();
  const send = useTvSend();
  if (!seat || tvs <= 0) return null;
  const nameOf = (c: Color) => names[c] ?? c;
  const tip = send.st.kind === 'sent' ? 'Sent to the TV' : send.st.kind === 'error' ? send.st.text : null;
  return (
    <span style={{position: 'relative', flex: 'none', display: 'inline-flex'}}>
      <button type="button" data-testid="dock-replay-last" data-state={send.st.kind} aria-label="Show last move on the TV" title="Show last move on the TV"
        disabled={!last || send.st.kind === 'busy'} onClick={() => last && send.run(useNet.getState().askReplay(seat, replayOf(last, nameOf)))}
        style={{width: 40, height: 40, borderRadius: 12, display: 'grid', placeItems: 'center', background: 'rgba(255,255,255,.06)', color: last ? 'var(--ice-dim)' : 'var(--ice-faint)'}}>
        <TvGlyph size={20} replay />
      </button>
      <AnimatePresence>
        {tip && (
          <motion.span key={tip} role="status" data-testid="dock-replay-tip" initial={{opacity: 0, y: 4}} animate={{opacity: 1, y: 0}} exit={{opacity: 0}}
            style={{position: 'absolute', right: 0, bottom: 48, padding: '5px 10px', borderRadius: 10, fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap', pointerEvents: 'none',
              background: 'rgba(30,14,10,.96)', color: 'var(--ice)', boxShadow: 'inset 0 0 0 1px var(--rim-strong), 0 6px 18px rgba(0,0,0,.4)'}}>{tip}</motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

/** The newest play of each colour this page has already accounted for (undefined: none yet, the first look sets it). */
const seenPlay = new Map<string, string | null | undefined>();

/** How long the pill stays: about as long as the TV holds a played card in the middle. */
export const ON_TV_MS = 4200;

/**
 * "On the TV now": after this player's card play is committed (the engine logged it and its follow-up questions are
 * answered), a small pill while the TV presents it. Never blocks a tap (no pointer events).
 */
export function OnTvPill({color}: {color: Color}) {
  const tvs = useNet((s) => s.tvs);
  const logs = useNet((s) => (s.fullView?.role === 'player' ? s.fullView.logs ?? NO_LOGS : NO_LOGS));
  const moving = useNet((s) => s.fullView?.moving ?? null);
  // the newest "<me> played <card>" line: its key changes when a new play lands
  const newest = useMemo(() => {
    for (let i = logs.length - 1; i >= 0; i--) {
      const l = logs[i];
      if (/^\$\{0\} played \$\{1\}$/.test(l.message) && l.data[0]?.value === color) return {key: `${l.timestamp}|${l.data[1]?.value}`, card: String(l.data[1]?.value ?? '')};
    }
    return null;
  }, [logs, color]);
  // module-level, so a dock that remounts (a tab or screen change) does not take a new play for an old one
  const first = {get current() { return seenPlay.get(color); }, set current(v: string | null | undefined) { seenPlay.set(color, v); }};
  const [show, setShow] = useState<{key: string; card: string} | null>(null);
  const [waiting, setWaiting] = useState<{key: string; card: string} | null>(null);
  useEffect(() => {
    // what was already in the log when the phone opened is not news
    if (first.current === undefined) { first.current = newest?.key ?? null; return; }
    if (!newest || newest.key === first.current) return;
    first.current = newest.key;
    if (tvs > 0) setWaiting(newest);
  }, [newest, tvs]);
  // the TV holds a move's moments while its player still answers its follow-up questions
  useEffect(() => {
    if (!waiting || moving === color) return;
    setShow(waiting); setWaiting(null);
  }, [waiting, moving, color]);
  useEffect(() => {
    if (!show) return;
    const t = setTimeout(() => setShow(null), ON_TV_MS);
    return () => clearTimeout(t);
  }, [show]);
  // test hook: what the pill is waiting for or showing
  (window as unknown as {__onTv?: unknown}).__onTv = {newest: newest?.key ?? null, first: first.current ?? null, waiting: waiting?.key ?? null, show: show?.key ?? null, moving, tvs};
  const c = PLAYER_HEX[color as keyof typeof PLAYER_HEX] ?? 'var(--ice)';
  return (
    <AnimatePresence>
      {show && (
        <motion.div key={show.key} data-testid="on-tv-pill" role="status" aria-live="polite"
          initial={{opacity: 0, y: 6, scale: 0.94}} animate={{opacity: 1, y: 0, scale: 1}} exit={{opacity: 0, y: 4}} transition={{type: 'spring', stiffness: 380, damping: 28}}
          style={{position: 'absolute', left: 16, top: -34, maxWidth: 'calc(100% - 140px)', display: 'flex', alignItems: 'center', gap: 7, height: 28, padding: '0 12px 0 9px',
            borderRadius: 999, pointerEvents: 'none', background: 'rgba(30,14,10,.94)', color: 'var(--ice)', fontSize: 13, fontWeight: 650,
            boxShadow: `inset 0 0 0 1.5px color-mix(in oklab, ${c} 60%, transparent), 0 6px 18px rgba(0,0,0,.35)`}}>
          <span style={{color: c, display: 'grid'}}><TvGlyph size={15} /></span>
          <span style={{whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>On the TV now<span className="faint" style={{fontWeight: 500}}> · {cardLabel(show.card)}</span></span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
