// Phone-to-TV links on the TV (src/shared/tvlinks.ts). Mounted once by FullTv over the whole screen:
//   - map echo: the spaces a phone asked about glow on the board (echoStore.ts, drawn by both boards) and the trackers
//     (temperature, oxygen, oceans, a player's resource cell or TR) get a pulsing ring, for 3 s; changes nothing
//   - replay: a move a phone asked to see again goes to the move pipeline's replayMoment (Phase 3 and 4 only; it waits
//     behind live moments and never interrupts one), with "Vera asked to see this again" in small text while it shows
// Reduced motion: the rings and glows are lit and still.
import {AnimatePresence, motion} from 'motion/react';
import {useEffect, useRef, useState} from 'react';
import {findCard} from '../../../shared/cards';
import type {Color} from '../../../shared/full';
import {ECHO_MS} from '../../../shared/tvlinks';
import type {Echo, EchoTarget, Replay} from '../../../shared/tvlinks';
import {useNet} from '../../net';
import {PLAYER_HEX} from '../../ui/Icons';
import {tvt} from '../settings';
import {prefersReducedMotion} from '../../ui/tokens';
import {useCinemaCovering} from '../cinema/CinemaLayer';
import {lightSpaces} from './echoStore';
import {replayMoment, usePipeline} from './pipeline/store';
import type {ReplayMoment} from './pipeline/store';

/** Asks older than this when they reach the TV (a reconnect replaying the store) are not shown. */
const FRESH_MS = 4000;
/** An echo waits while a cinematic or the production show covers the board, at most this long. */
const ECHO_WAIT_MS = 15000;

/** A cinematic or the production show covers the board right now (an echo under it would go unseen). */
function useBoardCovered(): boolean {
  const cinema = useCinemaCovering();
  const show = useNet((s) => s.production);
  const [, tick] = useState(0);
  const playing = !!show && Date.now() < show.localStart + show.durationMs;
  useEffect(() => {
    if (!playing || !show) return;
    const t = setTimeout(() => tick((n) => n + 1), show.localStart + show.durationMs - Date.now() + 20);
    return () => clearTimeout(t);
  }, [playing, show]);
  return cinema || playing;
}

const hexOf = (c: string) => PLAYER_HEX[c as keyof typeof PLAYER_HEX] ?? '#F2C230';

/** Where a tracker sits on screen, from the TV's own layout (Globals.tsx, Players.tsx). */
export function trackerElement(t: EchoTarget): Element | null {
  if (t.kind === 'global') {
    if (t.param === 'temperature') return document.querySelector('[data-gauge="Temp"]');
    if (t.param === 'oxygen') return document.querySelector('[data-gauge="Oxygen"]');
    return document.querySelector('[data-ocean-pips]')?.parentElement ?? null;
  }
  if (t.kind === 'res') return document.querySelector(`[data-strip-color="${t.color}"] [data-res-cell="${t.resource}"]`);
  if (t.kind === 'tr') return document.querySelector(`[data-strip-color="${t.color}"] [data-panel-stats] > div`);
  return null;
}

type Ring = {key: string; target: EchoTarget; color: string; until: number};
type Rect = {left: number; top: number; width: number; height: number};

export function EchoLayer() {
  const echoes = useNet((s) => s.echoes);
  const replays = useNet((s) => s.replays);
  // read live (motion's hook keeps the value it had when the layer mounted)
  const reduced = prefersReducedMotion();
  const covered = useBoardCovered();
  // test hook: echoes wait while this is true
  (window as unknown as {__echoCovered?: boolean}).__echoCovered = covered;
  const done = useRef(new Set<string>());
  const waiting = useRef<Echo[]>([]);
  const [rings, setRings] = useState<Ring[]>([]);
  const [captions, setCaptions] = useState<Array<{key: string; text: string; color: string; until: number}>>([]);

  // ---- map echo ----
  useEffect(() => {
    const now = Date.now();
    for (const e of echoes) {
      if (done.current.has(e.id)) continue;
      done.current.add(e.id);
      if (now - e.at > FRESH_MS) continue;
      waiting.current.push(e);
    }
    // under a cinematic or the production show the echo waits (and is dropped if that takes too long)
    if (covered) return;
    const go = waiting.current.filter((e) => Date.now() - e.at < ECHO_WAIT_MS);
    waiting.current = [];
    for (const e of go) start(e);
    function start(e: Echo) {
      const until = Date.now() + ECHO_MS;
      lightSpaces(e.id, e.targets.flatMap((t) => (t.kind === 'space' ? [t.spaceId] : [])), e.from.color, ECHO_MS);
      const add = e.targets.filter((t) => t.kind !== 'space').map((t, i) => ({key: `${e.id}:${i}`, target: t, color: e.from.color, until}));
      if (add.length) setRings((r) => [...r.filter((x) => x.until > Date.now()), ...add]);
      setCaptions((c) => [...c.filter((x) => x.until > Date.now()), {key: e.id, text: `${e.from.name} asked to see this`, color: e.from.color, until}]);
      (window as unknown as {__echoesShown?: unknown[]}).__echoesShown = [...((window as unknown as {__echoesShown?: unknown[]}).__echoesShown ?? []), {id: e.id, at: Date.now(), targets: e.targets}];
    }
  }, [echoes, covered]);
  useEffect(() => {
    if (!rings.length && !captions.length) return;
    const next = Math.min(...[...rings, ...captions].map((x) => x.until)) - Date.now();
    const t = setTimeout(() => {
      setRings((r) => r.filter((x) => x.until > Date.now()));
      setCaptions((c) => c.filter((x) => x.until > Date.now()));
    }, Math.max(30, next + 20));
    return () => clearTimeout(t);
  }, [rings, captions]);

  // ---- replay ----
  const replayer = useReplayer(replays, done);

  const caption = replayer ?? captions[captions.length - 1] ?? null;
  return (
    <div data-echo-layer="" style={{position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 34}}>
      {rings.map((r) => <TrackerRing key={r.key} ring={r} reduced={reduced} />)}
      <AnimatePresence>
        {caption && (
          <motion.div key={caption.key} data-testid="tv-asked" initial={{opacity: 0, y: -6}} animate={{opacity: 1, y: 0}} exit={{opacity: 0}} transition={{duration: reduced ? 0.15 : 0.3}}
            style={{position: 'absolute', left: '50%', top: '1.6vh', transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: '0.5vw', whiteSpace: 'nowrap',
              padding: '0.45vh 0.9vw', borderRadius: 999, background: 'rgba(12,5,3,.72)', color: 'var(--ice-dim)', fontSize: tvt(0.95), fontWeight: 600}}>
            <span style={{width: '0.6vw', height: '0.6vw', borderRadius: '0.15vw', background: hexOf(caption.color)}} />
            {caption.text}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** A pulsing ring round a tracker, following it if the layout moves (panels fold, odometers roll). */
function TrackerRing({ring, reduced}: {ring: Ring; reduced: boolean}) {
  const [rect, setRect] = useState<Rect | null>(null);
  useEffect(() => {
    const measure = () => {
      const el = trackerElement(ring.target);
      if (!el) { setRect(null); return; }
      const r = el.getBoundingClientRect();
      setRect((o) => (o && Math.abs(o.left - r.left) < 1 && Math.abs(o.top - r.top) < 1 && Math.abs(o.width - r.width) < 1 && Math.abs(o.height - r.height) < 1
        ? o : {left: r.left, top: r.top, width: r.width, height: r.height}));
    };
    measure();
    const t = setInterval(measure, 250);
    return () => clearInterval(t);
  }, [ring.target]);
  if (!rect) return null;
  const c = hexOf(ring.color);
  const pad = window.innerWidth * 0.004;
  return (
    <motion.div data-echo-ring={ring.target.kind === 'global' ? ring.target.param : ring.target.kind === 'res' ? `${ring.target.color}:${ring.target.resource}` : `${(ring.target as {color: Color}).color}:tr`}
      initial={{opacity: 0}} animate={reduced ? {opacity: 1} : {opacity: [0.45, 1, 0.45]}} exit={{opacity: 0}}
      transition={reduced ? {duration: 0.15} : {duration: 1, repeat: Infinity, ease: 'easeInOut'}}
      style={{position: 'fixed', left: rect.left - pad, top: rect.top - pad, width: rect.width + pad * 2, height: rect.height + pad * 2, borderRadius: '0.6vw',
        boxShadow: `0 0 0 0.18vw #FFF4E0, 0 0 0 0.36vw ${c}, 0 0 1.6vw 0.5vw color-mix(in oklab, ${c} 70%, transparent)`}} />
  );
}

/** A phone's move as the pipeline's replay (cards the TV knows; a standard project or a conversion points at its space). */
export function momentOf(r: Replay): ReplayMoment {
  const m = r.move;
  const card = m.card && findCard(m.card) ? m.card : undefined;
  const verb = m.how === 'played' ? 'played' : m.how === 'first' ? 'took the first action of' : m.how === 'used' || m.how === 'reused' ? 'used' : undefined;
  return {color: m.by, ...(card ? {card} : {}), ...(verb && card ? {verb} : {}), ...(m.gains?.length ? {gains: m.gains.map((g) => ({r: g.r, n: g.n, prod: g.prod}))} : {}),
    ...(m.spaceId ? {spaceId: m.spaceId} : {})};
}

/** A replay that started and never said it was done (its onDone) is let go after this long. */
const REPLAY_SHOW_MS = 12000;
/** A replay the pipeline never took (no TV layer running it) is let go after this long. */
const REPLAY_GIVE_UP_MS = 20000;

/**
 * Hands each new replay to the pipeline once, and tells the server when it is over (the asker's cooldown runs from
 * then). Its caption shows from when the pipeline takes it until it ends. Returns the caption to show, if any.
 */
function useReplayer(replays: Replay[], done: React.MutableRefObject<Set<string>>) {
  const [live, setLive] = useState<Array<{r: Replay; k: string; queued: number; started: number | null}>>([]);
  const replayDone = useNet((s) => s.replayDone);
  // the pipeline calls onDone once the replay has played (or was dropped): the caption goes and the asker's cooldown runs
  const ended = useRef(new Set<string>());
  const [, bump] = useState(0);
  useEffect(() => {
    const now = Date.now();
    const add: typeof live = [];
    for (const r of replays) {
      if (done.current.has(r.id)) continue;
      done.current.add(r.id);
      if (now - r.at > FRESH_MS) { replayDone(r.id); continue; }
      add.push({r, k: replayMoment({...momentOf(r), onDone: () => { ended.current.add(r.id); bump((n) => n + 1); }}), queued: now, started: null});
    }
    if (add.length) setLive((l) => [...l, ...add]);
  }, [replays]); // eslint-disable-line react-hooks/exhaustive-deps
  // the pipeline takes a replay off its waiting list when it starts showing it
  const waiting = usePipeline((s) => s.replays);
  useEffect(() => {
    if (!live.length) return;
    const tick = () => {
      const now = Date.now();
      const keys = new Set(usePipeline.getState().replays.map((x) => x.k));
      let changed = false;
      const next = live.flatMap((x) => {
        if (ended.current.has(x.r.id)) { changed = true; ended.current.delete(x.r.id); replayDone(x.r.id); return []; }
        if (x.started === null && !keys.has(x.k)) { changed = true; return [{...x, started: now}]; }
        const over = x.started !== null ? now - x.started > REPLAY_SHOW_MS : now - x.queued > REPLAY_GIVE_UP_MS;
        if (over) { changed = true; replayDone(x.r.id); return []; }
        return [x];
      });
      if (changed) setLive(next);
    };
    tick();
    const t = setInterval(tick, 200);
    return () => clearInterval(t);
  }, [live, waiting]); // eslint-disable-line react-hooks/exhaustive-deps
  const on = live.find((x) => x.started !== null);
  return on && !ended.current.has(on.r.id) ? {key: on.r.id, text: `${on.r.from.name} asked to see this again`, color: on.r.from.color, until: on.started! + REPLAY_SHOW_MS} : null;
}
