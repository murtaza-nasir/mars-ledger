// Mission control's captions on the TV. Lines arrive from the server (TV sockets only), wait their turn
// behind cinematics, the production show, companion moments and flicked cards, and are dropped if they
// wait too long. In 'voice' mode a line is also spoken through the sound layer (so the TV's unlock, mute
// and ducking apply); one line at a time, never overlapping. A busy stage only delays a line: a stage that stays busy
// past a cap stops holding captions back, so a stuck flag cannot silence a whole game. A voice line on a TV whose sound
// is still locked first tries to start the sound (browsers that let the page play, as they let the radio, allow it).
// Each line's fate goes back to the server (shown, spoken, or why not), for its log and /api/health.
import {AnimatePresence, motion} from 'motion/react';
import {Fragment, useEffect, useRef, useState, useSyncExternalStore} from 'react';
import {NARRATOR_LABEL, readingMs, STAGE_WAIT_MAX_MS, STORY_WAIT_MAX_MS} from '../../../shared/narrator';
import type {NarrationLine, NarratorMode} from '../../../shared/narrator';
import {useNet} from '../../net';
import {useCinemaBusy} from '../cinema/CinemaLayer';
import {director} from '../sound/director';
import {DUCK_DEPTH, radioMix} from '../radio/mix';
import {useStage} from '../stage';
import {useRadio} from '../radio/store';
import {LANE_LEFT} from '../dock';
import {getSettings, tvt} from '../settings';
import {gateNames, pickLine, silentReason, stageHolds} from './gate';
import type {NarrationReport} from '../../../shared/narrator';

/** A caption being shown. `shownMs` is how long it has been visible so far; it pauses while the stage is busy. */
type Current = {line: NarrationLine; totalMs: number; shownMs: number; visibleSince: number | null; speaking: boolean; spoke: boolean};
type Notice = {mode: NarratorMode; until: number};

/** A paused caption whose line is older than this is dropped instead of coming back. */
const RESUME_LIMIT_MS = 45_000;

function useProductionLive(): boolean {
  const show = useNet((s) => s.production);
  const [, tick] = useState(0);
  const live = !!show && Date.now() < show.localStart + show.durationMs + 400;
  useEffect(() => {
    if (!live || !show) return;
    const t = setTimeout(() => tick((x) => x + 1), show.localStart + show.durationMs + 450 - Date.now());
    return () => clearTimeout(t);
  }, [live, show]);
  return live;
}

export function NarratorLayer() {
  const enabled = useNet((s) => s.config?.narrator !== false);
  const mode = useNet((s) => s.state?.narrator ?? 'off');
  const fullGame = useNet((s) => s.state?.mode === 'full' && s.state.phase !== 'lobby');
  // Until the TV's sound is unlocked, its "Tap or press any key for sound" chip sits in the bottom-right corner.
  const soundChip = useSyncExternalStore((l) => director.subscribe(l), () => !director.unlocked && !director.muted);
  const lines = useNet((s) => s.narrations);
  const cinema = useCinemaBusy();
  const production = useProductionLive();
  const moment = useStage((s) => s.moment);
  const flick = useStage((s) => s.flick);
  const story = useStage((s) => s.story);
  const busyNames = gateNames({cinema, production, moment, flick, story});
  const busy = busyNames !== '';
  // Since when the stage has been busy without a break; past the cap it no longer holds captions back.
  const [busySince, setBusySince] = useState<number | null>(null);
  const [overdue, setOverdue] = useState(false);
  useEffect(() => {
    if (!busy) { setBusySince(null); setOverdue(false); return; }
    const since = Date.now();
    setBusySince(since);
    setOverdue(false);
    const t = setTimeout(() => setOverdue(true), Math.max(0, (story ? STORY_WAIT_MAX_MS : STAGE_WAIT_MAX_MS)));
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy]);
  const blocked = busy && !overdue && stageHolds(busySince ?? Date.now(), Date.now(), story);
  const busyRef = useRef(busyNames);
  busyRef.current = busyNames;
  const report = (r: NarrationReport) => { try { useNet.getState().narrationSeen(r); } catch { /* reporting is best effort */ } };

  const [current, setCurrent] = useState<Current | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const done = useRef(new Set<string>());
  const mounted = useRef(Date.now());

  // The table changed the setting: say so briefly (not on first load).
  const lastMode = useRef<NarratorMode | null>(null);
  useEffect(() => {
    if (lastMode.current !== null && lastMode.current !== mode) {
      setNotice({mode, until: Date.now() + 2800});
      if (mode === 'off') setCurrent(null);
    }
    lastMode.current = mode;
  }, [mode]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), Math.max(0, notice.until - Date.now()));
    return () => clearTimeout(t);
  }, [notice]);

  // Lines that waited past their time are skipped and reported with what held them (checked whatever else is showing,
  // so a stuck screen still leaves a trace in the server log).
  const [clock, setClock] = useState(0);
  useEffect(() => {
    if (!enabled || mode === 'off') return;
    const now = Date.now();
    const {expired} = pickLine(lines, done.current, now, mounted.current);
    for (const l of expired) {
      done.current.add(l.id);
      const held = busyRef.current || (current ? 'another caption' : notice ? 'a mode notice' : 'nothing');
      report({id: l.id, shown: false, spoke: false, reason: `expired after ${Math.round((now - l.at) / 1000)} s behind ${held}`});
    }
    // look again when the oldest waiting line would expire
    const waiting = lines.filter((l) => !done.current.has(l.id) && l.at >= mounted.current - 500);
    if (!waiting.length) return;
    const soonest = Math.min(...waiting.map((l) => l.at + l.ttlMs)) - now + 50;
    const t = setTimeout(() => setClock((x) => x + 1), Math.max(250, soonest));
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, mode, lines, current, notice, clock]);

  // Take the next line when the stage is free and nothing else is showing.
  useEffect(() => {
    if (!enabled || mode === 'off' || blocked || current || notice) return;
    const now = Date.now();
    const {next} = pickLine(lines, done.current, now, mounted.current);
    if (!next) return;
    done.current.add(next.id);
    const heldBy = busy ? busyNames : null;
    setCurrent({line: next, totalMs: readingMs(next.text), shownMs: 0, visibleSince: now, speaking: false, spoke: false});
    const shownNote = heldBy ? `shown over ${heldBy} (busy past the cap)` : undefined;
    if (mode === 'voice' && next.audioUrl) {
      const url = next.audioUrl;
      void (async () => {
        // A TV nobody has tapped yet: try to start its sound (allowed when the browser lets the page play sound).
        if (!director.canSpeak && !director.muted) {
          director.unlock();
          for (let i = 0; i < 8 && !director.canSpeak; i++) await new Promise((r) => setTimeout(r, 50));
        }
        const silent = silentReason({muted: director.muted, canSpeak: director.canSpeak});
        const ms = silent ? null : await director.speak(url);
        if (ms === null) {
          report({id: next.id, shown: true, spoke: false, reason: [shownNote, silent ?? 'audio failed to load or decode'].filter(Boolean).join('; ')});
          return;
        }
        const st = getSettings();
        const quiet = st.voice === 0 || st.master === 0 ? 'voice volume is 0 in TV options' : undefined;
        report({id: next.id, shown: true, spoke: true, reason: [shownNote, quiet].filter(Boolean).join('; ') || undefined});
        radioMix.duck('voice', DUCK_DEPTH.voice, ms + 300);
        setCurrent((c) => (c?.line.id === next.id ? {...c, speaking: true, spoke: true, totalMs: Math.max(c.totalMs, c.shownMs + ms + 500)} : c));
        setTimeout(() => setCurrent((c) => (c?.line.id === next.id ? {...c, speaking: false} : c)), ms);
      })();
    } else {
      report({id: next.id, shown: true, spoke: false, reason: shownNote});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, mode, blocked, current, notice, lines]);

  // Pause while the stage is busy; resume afterwards with the reading time that was left.
  useEffect(() => {
    if (!current) return;
    const now = Date.now();
    const hold = blocked || !!notice;
    if (hold && current.visibleSince !== null) {
      setCurrent({...current, shownMs: current.shownMs + (now - current.visibleSince), visibleSince: null});
    } else if (!hold && current.visibleSince === null) {
      if (now - current.line.at > Math.max(RESUME_LIMIT_MS, current.line.ttlMs + 15_000)) { setCurrent(null); return; }
      // a line that comes back after its voice has played gets at least a short second look
      setCurrent({...current, visibleSince: now, totalMs: Math.max(current.totalMs, current.shownMs + 2500)});
    }
  }, [blocked, current, notice]);

  // End the caption when its visible time is used up.
  useEffect(() => {
    if (!current || current.visibleSince === null) return;
    const left = current.totalMs - current.shownMs - (Date.now() - current.visibleSince);
    const t = setTimeout(() => setCurrent((c) => (c?.line.id === current.line.id ? null : c)), Math.max(0, left));
    return () => clearTimeout(t);
  }, [current]);

  const deckRight = useRadio((s) => s.deckRight);
  const showLine = !!current && current.visibleSince !== null && !notice;
  const visible = enabled && (!!notice || showLine);
  useEffect(() => { useStage.getState().set('caption', visible); }, [visible]);
  if (!enabled) return null;
  // Full game: start at the board's left edge so the instrument column (ocean pips) stays clear. Companion: start after
  // the bottom-left dock (gear and sound toggle) and keep clear of the "tap for sound" chip while it shows.
  // Full game: the caption spans the board's column, between the instrument column (ocean pips) and the
  // milestone panel, in up to three lines. Companion: the whole lane, leaving the corner to the sound button.
  // (the radio deck in the bottom-left corner pushes the caption's start past it)
  const lane = fullGame ? {left: deckRight ? `max(17vw, calc(${deckRight}px + 1.4vw))` : '17vw', right: '33vw'} : {left: LANE_LEFT, right: soundChip ? '22vw' : '2.4vw'};
  return (
    <div aria-live="polite" data-narrator-lane style={{position: 'fixed', ...lane, bottom: '1.4vh', zIndex: 60, pointerEvents: 'none'}}>
      <AnimatePresence mode="wait">
        {(notice || showLine) && (
          <motion.div key={notice ? `notice-${notice.mode}-${notice.until}` : current!.line.id}
            initial={{opacity: 0, y: '1.2vh'}} animate={{opacity: 1, y: 0}} exit={{opacity: 0, y: '0.8vh'}}
            transition={{duration: 0.45, ease: [0.2, 0.9, 0.25, 1]}}
            style={{display: 'flex', alignItems: 'center', gap: '1.4vw', padding: '0.75vw 1.4vw 0.75vw 1.1vw', borderRadius: '1.1vw',
              background: 'linear-gradient(90deg, rgba(8,4,3,.94), rgba(14,7,5,.88))', backdropFilter: 'blur(10px)',
              boxShadow: 'inset 0 0 0 1px var(--rim-strong), 0 1.2vw 3vw rgba(0,0,0,.45)'}}>
            <Label speaking={!notice && !!current?.speaking} />
            {notice
              ? <div style={{fontSize: '1.3vw', fontWeight: 600, color: 'var(--ice-dim)'}}>
                {notice.mode === 'off' ? 'Mission control is signing off.' : `Mission control is on: ${NARRATOR_LABEL[notice.mode].toLowerCase()}.`}
              </div>
              : <Caption text={current!.line.text} lines={fullGame ? 3 : 2} size={fullGame ? '1.2vw' : '1.32vw'} />}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** "Mission control" with a small signal indicator that moves while the voice is speaking. */
function Label({speaking}: {speaking: boolean}) {
  return (
    <div style={{display: 'flex', alignItems: 'center', gap: '0.55vw', flex: 'none', paddingRight: '1.2vw', borderRight: '1px solid var(--rim-strong)'}}>
      <div aria-hidden style={{display: 'flex', alignItems: 'flex-end', gap: '0.18vw', height: '1.1vw'}}>
        {[0.45, 0.75, 1].map((h, i) => (
          <motion.span key={i} animate={speaking ? {scaleY: [h, 1, h * 0.6, h]} : {scaleY: h}}
            transition={speaking ? {duration: 0.9, repeat: Infinity, delay: i * 0.15, ease: 'easeInOut'} : {duration: 0.3}}
            style={{display: 'block', width: '0.26vw', height: '1.1vw', borderRadius: '0.2vw', background: 'var(--tr)', transformOrigin: 'bottom', opacity: speaking ? 1 : 0.7}} />
        ))}
      </div>
      <span className="cond" style={{fontSize: tvt(1.05), fontWeight: 650, color: 'var(--tr)', whiteSpace: 'nowrap'}}>Mission control</span>
    </div>
  );
}

/** The line itself: words settle in quickly, one after another. */
function Caption({text, lines, size}: {text: string; lines: number; size: string}) {
  const words = text.split(' ');
  return (
    <p style={{margin: 0, fontSize: size, lineHeight: 1.3, fontWeight: 560, color: 'var(--ice)', fontVariationSettings: "'wdth' 94",
      display: '-webkit-box', WebkitLineClamp: lines, WebkitBoxOrient: 'vertical', overflow: 'hidden'}}>
      {words.map((w, i) => (
        <Fragment key={i}>
          <motion.span initial={{opacity: 0, filter: 'blur(4px)'}} animate={{opacity: 1, filter: 'blur(0px)'}}
            transition={{duration: 0.35, delay: Math.min(1.2, i * 0.035)}} style={{display: 'inline-block'}}>
            {w}
          </motion.span>
          {i < words.length - 1 ? ' ' : null}
        </Fragment>
      ))}
    </p>
  );
}

/** The log ticker steps back while mission control's caption holds the bottom lane. */
export function TickerFade({children}: {children: React.ReactNode}) {
  const caption = useStage((s) => s.caption);
  return <div style={{opacity: caption ? 0.12 : 1, transition: 'opacity .45s ease'}}>{children}</div>;
}
