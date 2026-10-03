// The TV radio: the server's YouTube playlist (RADIO_PLAYLIST), played through YouTube's official IFrame Player
// API in a small corner deck that looks like a radio: the player itself is the album window (always visible,
// at least 200×200 CSS px, with YouTube's own controls off), a slim strip of ⏮ ⏯ ⏭ with a thin progress line (beside
// the window in full games, above it in companion games), and the track's name (beside the window in full games, a
// card that slides out for a few seconds in companion games).
//
// It plays from the first player move after setup to the end of the game, in playlist order, resumes where it
// was after a reload, ducks under the TV's own sound (see mix.ts) and steps aside quietly when YouTube or the
// playlist will not play. It is off until switched on in the TV options.
import {AnimatePresence, motion, useReducedMotion} from 'motion/react';
import {useEffect, useRef, useState, useSyncExternalStore} from 'react';
import {useNet} from '../../net';
import {tvt, useTvSettings, getSettings, setSettings} from '../settings';
import {director} from '../sound/director';
import {useCinema} from '../cinema/queue';
import {useStage} from '../stage';
import {isSwitchAction, thumbnailUrl, trackInfo} from '../../../shared/radio';
import type {RadioAction, RadioNow} from '../../../shared/radio';
import {DUCK_DEPTH, errorKind, errorText, gameKeyOf, glide, parseResume, playerVolume, RESUME_KEY, radioStage, SkipGuard, StageLatch, startPoint} from './logic';
import {radioMix} from './mix';
import {useRadio} from './store';
import {DOCK_END} from '../dock';
import type {Track} from './store';
import {loadYouTube, YT_HOST, YT_STATE} from './youtube';
import type {YTPlayer} from './youtube';

/** How long the track card stays out, and how long a new track may wait for the stage to clear. */
const CARD_MS = 6000;
const CARD_WAIT_MS = 45_000;
/** The deck brightens for this long after any activity (track change, a press, the remote). */
const AWAKE_MS = 6000;
/** The music stays down this long after the production show, until its generation recap (queued 0.3 s after the show, started on the cinema's 0.25 s pump) has begun. */
const SHOW_TAIL_MS = 900;

/** The album window: never under YouTube's 200×200 minimum, a little larger on a 4K screen at 1:1. */
const WINDOW = 'max(200px, 10.4vw)';

/**
 * Where the deck sits. Full game: the board box's bottom-right corner, clear of the hexes on every map (flat and
 * 3D; the strip is right-aligned so it stays clear of the flat board's row above), of the side column, of the log
 * ticker and of mission control's caption (three lines rise to ~87.5vh, so the window ends at 87vh).
 * Companion: beside the planet's lower right, clear of the gauges and the player column.
 */
type Place = {right: string; bottom: string; card: {right: string; bottom: string; from: 'right' | 'below'}};
const PLACE: Record<'full' | 'companion', Place> = {
  // the card slides out to the left along the band under the board's bottom row
  full: {right: '33.4vw', bottom: '13vh', card: {right: `calc(33.4vw + ${WINDOW} + 0.7vw)`, bottom: '8.4vh', from: 'right'}},
  // the card rises above the deck, over the planet (the gauges sit to the left)
  companion: {right: '40vw', bottom: '9.6vw', card: {right: '40vw', bottom: `calc(9.6vw + ${WINDOW} + 3.4vw)`, from: 'below'}},
};

/**
 * While a full-screen cinematic plays, the album window glides to the spot that cinematic leaves empty (the strip
 * fades out meanwhile); the player stays visible the whole time. Recap: the gap above the TR chart, between the
 * title and the highlight cards. Milestones: the sky in the top-right corner. Anything else (the corporation
 * reveal): the bottom-right corner above the speaker button.
 */
const ASIDE: Record<string, {right: string; top?: string; bottom?: string}> = {
  recap: {right: '42.6vw', top: '1.5vh'},
  milestone: {right: '2vw', top: '3vh'},
  other: {right: '4.2vw', bottom: '5.2vw'},
};
/** The transform that carries the deck (its window's bottom-right corner) from home to a cinematic's spot. */
function asideTransform(home: Place, kind: string): string {
  const a = ASIDE[kind] ?? ASIDE.other;
  const dx = `calc(${home.right} - ${a.right})`;
  const dy = a.top !== undefined ? `calc(${a.top} + ${WINDOW} + ${home.bottom} - 100vh)` : `calc(${home.bottom} - ${a.bottom})`;
  return `translate(${dx}, ${dy})`;
}

/**
 * Full game: the deck is a row in the bottom-left corner, beside the options gear: the album window (YouTube's
 * 200×200 CSS px minimum, a fixed size while everything else scales with the screen) and our own controls beside it,
 * in the band of the log ticker, which starts after the deck. The window rises over the foot of the instrument
 * column and the board box's empty bottom-left corner (no map has hexes there); the column keeps only the room the
 * window takes above its own foot (RADIO_SLOT_H), so the gauges keep their height on TVs that lay the page out at
 * 1280–1536 CSS px.
 */
const DECK_LEFT = `calc(${DOCK_END} + 0.6vw)`;
const DECK_BOTTOM = '1.2vh';
/** The instrument column ends 9vh above the screen's foot and keeps a 1.6vh gap: what the window takes above that. */
export const RADIO_SLOT_H = `max(0px, calc(${DECK_BOTTOM} + 200px + 1.4vh - 9vh - 1.6vh))`;

const latch = new StageLatch();
function savedGame(): string | null {
  try { return parseResume(localStorage.getItem(RESUME_KEY))?.game ?? null; } catch { return null; }
}

export function Radio() {
  const settings = useTvSettings();
  const state = useNet((s) => s.state);
  const model = useNet((s) => (s.fullView?.role === 'spectator' ? s.fullView.model : null));
  const status = useRadio((s) => s.status);
  // RADIO_PLAYLIST on the server; without it there is no radio at all
  const playlist = useNet((s) => s.config?.radioPlaylist ?? null);
  const game = gameKeyOf(state);
  const stage = latch.observe(game, radioStage(state, model), savedGame());

  // Switching the radio off, or a new game, lets an unavailable radio try again.
  useEffect(() => {
    if (!settings.radio) useRadio.getState().set({status: 'idle', notice: null, track: null, playing: false, needsGesture: false, progress: 0});
  }, [settings.radio]);
  useEffect(() => { useRadio.getState().set({skipped: 0, ...(useRadio.getState().status === 'unavailable' ? {status: 'idle', notice: null} : {})}); }, [game]);
  // Back online: try again.
  useEffect(() => {
    const online = () => { if (useRadio.getState().status === 'unavailable') useRadio.getState().set({status: 'idle', notice: null}); };
    window.addEventListener('online', online);
    return () => window.removeEventListener('online', online);
  }, []);

  // A phone's Radio switch: applied as if this TV's own switch had been flipped (the per-screen setting).
  const command = useNet((s) => s.radioCommand);
  const seenSwitch = useRef(command?.seq ?? 0);
  useEffect(() => {
    if (!command || command.seq <= seenSwitch.current) return;
    seenSwitch.current = command.seq;
    if (isSwitchAction(command.action)) setSettings({radio: command.action === 'on'});
  }, [command]);

  const on = !!playlist && settings.radio && stage === 'playing' && !!game && status !== 'unavailable';
  // Whenever the deck is not up the phones hear whether the switch is on (the music waiting for the game) or off.
  const connected = useNet((s) => s.connected);
  useEffect(() => {
    if (on) return;
    radioMix.setPlaying(false);
    if (!connected) return;
    useNet.getState().reportRadio(playlist && settings.radio ? {enabled: true, on: false, playing: false, videoId: null, index: 0, title: '', artist: '', game: null} : null);
  }, [on, settings.radio, connected, playlist]);
  if (!on || !state || !playlist) return null;
  return <RadioDeck key={`${game}:${playlist}`} game={game} playlist={playlist} place={PLACE[state.mode === 'full' ? 'full' : 'companion']} />;
}

function RadioDeck({game, playlist, place}: {game: string; playlist: string; place: Place}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const reduced = !!useReducedMotion();
  const track = useRadio((s) => s.track);
  const playing = useRadio((s) => s.playing);
  const progress = useRadio((s) => s.progress);
  const needsGesture = useRadio((s) => s.needsGesture);
  const status = useRadio((s) => s.status);
  const [awakeUntil, setAwakeUntil] = useState(0);
  const [, tick] = useState(0);
  const wake = () => setAwakeUntil(Date.now() + AWAKE_MS);
  const awake = awakeUntil > Date.now();
  useEffect(() => {
    if (!awake) return;
    const t = setTimeout(() => tick((n) => n + 1), awakeUntil - Date.now() + 20);
    return () => clearTimeout(t);
  }, [awake, awakeUntil]);

  // the card waiting for a clear stage, and the one showing
  const [pending, setPending] = useState<{track: Track; at: number} | null>(null);
  const [card, setCard] = useState<{track: Track; key: number} | null>(null);

  // ---- the player ------------------------------------------------------------------------------
  const control = useRef<{action: (a: RadioAction) => void; tryStart: () => void; error: (code: number) => void} | null>(null);
  useEffect(() => {
    const set = useRadio.getState().set;
    let dead = false;
    let p: YTPlayer | null = null;
    let lastId: string | null = null;
    let configured = false;
    /** the person paused (a tap, the remote): the next gesture must not restart it */
    let userPaused = false;
    let pausedForMute = false;
    const guard = new SkipGuard();
    set({status: 'loading', notice: null, track: null, playing: false, progress: 0, needsGesture: false});

    const giveUp = (why: string) => {
      if (dead) return;
      useNet.getState().radioLog(`stepped aside: ${why}`);
      set({status: 'unavailable', notice: why, playing: false});
    };
    const readyTimer = window.setTimeout(() => giveUp('YouTube did not answer'), 20_000);

    const save = () => {
      if (!p) return;
      try {
        const index = p.getPlaylistIndex();
        if (index < 0) return;
        localStorage.setItem(RESUME_KEY, JSON.stringify({game, index, seconds: p.getCurrentTime() || 0, videoId: p.getVideoData()?.video_id ?? null}));
      } catch { /* storage off: a reload starts at the top */ }
    };

    const readTrack = (attempt = 0) => {
      if (!p || dead) return;
      const vd = p.getVideoData() ?? {};
      if (!vd.video_id || vd.video_id === lastId) return;
      // YouTube fills in the title and channel a moment after the video starts
      if ((!vd.title || !vd.author) && attempt < 8) { window.setTimeout(() => readTrack(attempt + 1), 300); return; }
      lastId = vd.video_id;
      const t: Track = {...trackInfo(vd.title ?? '', vd.author ?? ''), videoId: vd.video_id, index: Math.max(0, p.getPlaylistIndex())};
      set({track: t});
      setPending({track: t, at: Date.now()});
      wake();
      save();
    };

    const start = () => {
      if (!p) return;
      let saved = null;
      try { saved = parseResume(localStorage.getItem(RESUME_KEY)); } catch { /* no storage */ }
      const from = startPoint(saved, game);
      const activated = (navigator as Navigator & {userActivation?: {hasBeenActive: boolean}}).userActivation?.hasBeenActive ?? director.unlocked;
      const opts = {list: playlist, listType: 'playlist' as const, index: from.index, startSeconds: from.seconds};
      if (activated && !director.muted) {
        p.loadPlaylist(opts);
        // If the browser still holds the sound back, the next tap or key starts it.
        window.setTimeout(() => {
          if (dead || !p || userPaused) return;
          const st = p.getPlayerState();
          if (st !== YT_STATE.PLAYING && st !== YT_STATE.BUFFERING) set({needsGesture: true});
        }, 5000);
      } else {
        p.cuePlaylist(opts);
        set({needsGesture: !director.muted});
      }
    };

    const tryStart = () => {
      if (!p || !useRadio.getState().needsGesture || userPaused || director.muted) return;
      set({needsGesture: false});
      p.playVideo();
    };

    const onState = (st: number) => {
      if (!p || dead) return;
      if (!configured && (p.getPlaylist()?.length ?? 0) > 0) {
        configured = true;
        // in order, no repeat: the playlist runs once through the game
        p.setShuffle(false);
        p.setLoop(false);
      }
      if (st === YT_STATE.PLAYING) {
        guard.played();
        set({playing: true, needsGesture: false});
        readTrack();
      } else if (st === YT_STATE.PAUSED || st === YT_STATE.ENDED || st === YT_STATE.CUED) {
        set({playing: false});
        if (st === YT_STATE.CUED) readTrack();
      }
      if (st === YT_STATE.ENDED) {
        const list = p.getPlaylist() ?? [];
        // the last track ended: repeat is off, so the radio rests
        if (p.getPlaylistIndex() >= list.length - 1) save();
      }
    };

    const onError = (code: number) => {
      if (!p || dead) return;
      const list = p.getPlaylist() ?? [];
      const index = p.getPlaylistIndex();
      const id = p.getVideoData()?.video_id || list[index] || 'unknown';
      if (errorKind(code) === 'fatal') { giveUp('YouTube refused the playlist'); return; }
      useNet.getState().radioLog(`skipped track ${index + 1} (${id}): ${errorText(code)}, code ${code}`);
      set({skipped: useRadio.getState().skipped + 1});
      if (guard.skip(list.length) === 'give-up') { giveUp(`The playlist would not play (${errorText(code)})`); return; }
      if (index >= list.length - 1) { set({playing: false}); return; }
      window.setTimeout(() => { if (!dead) p?.nextVideo(); }, 400);
    };

    control.current = {
      tryStart,
      error: onError,
      action: (a) => {
        if (!p) return;
        wake();
        if (a === 'toggle') {
          const st = p.getPlayerState();
          if (st === YT_STATE.PLAYING || st === YT_STATE.BUFFERING) { userPaused = true; p.pauseVideo(); }
          else { userPaused = false; set({needsGesture: false}); p.playVideo(); }
        } else {
          userPaused = false;
          set({needsGesture: false});
          if (a === 'next') p.nextVideo(); else p.previousVideo();
        }
      },
    };

    loadYouTube().then((YT) => {
      if (dead || !hostRef.current) return;
      const el = document.createElement('div');
      hostRef.current.appendChild(el);
      p = new YT.Player(el, {
        width: '100%', height: '100%', host: YT_HOST,
        playerVars: {autoplay: 0, controls: 0, disablekb: 1, rel: 0, playsinline: 1, iv_load_policy: 3, fs: 0, modestbranding: 1, enablejsapi: 1, origin: location.origin},
        events: {
          onReady: () => {
            window.clearTimeout(readyTimer);
            if (dead) return;
            playerRef.current = p;
            set({status: 'ready'});
            start();
          },
          onStateChange: (e) => onState(e.data),
          onError: (e) => onError(e.data),
          onAutoplayBlocked: () => set({needsGesture: true, playing: false}),
        },
      });
    }).catch((e: Error) => giveUp(e.message));

    // ---- the mix: volume, ducking, mute, progress, resume point -----------------------------------
    let duck = 1;
    let sent = -1;
    let last = performance.now();
    let lastSave = 0;
    let lastProgress = 0;
    let lastHeard = -Infinity;
    const loop = window.setInterval(() => {
      const now = performance.now();
      const dt = now - last;
      last = now;
      // the production show and the big cinematics hold the music down while they are on screen
      const show = useNet.getState().production;
      const wall = Date.now();
      // (held a little past the show: its generation recap starts ~0.3 s after it, and the music should not swell between)
      if (show && wall >= show.localStart - 300 && wall <= show.localStart + show.durationMs + SHOW_TAIL_MS) radioMix.hold('production', DUCK_DEPTH.production);
      else radioMix.release('production');
      const cine = useCinema.getState().current;
      if (cine && cine.kind !== 'story') radioMix.hold('cinema', DUCK_DEPTH.cinema);
      else radioMix.release('cinema');
      duck = glide(duck, radioMix.level(), dt);
      const s = getSettings();
      const vol = playerVolume({radioVolume: s.radioVolume, master: s.master, muted: director.muted}, duck);
      const player = playerRef.current;
      if (!player) return;
      if (vol !== sent) {
        try { player.setVolume(vol); if (vol > 0 && player.isMuted()) player.unMute(); } catch { /* not ready */ }
        sent = vol;
      }
      // Sound switched off at the TV: the music pauses, and comes back with the sound.
      if (director.muted && useRadio.getState().playing) { pausedForMute = true; player.pauseVideo(); }
      else if (!director.muted && pausedForMute) { pausedForMute = false; if (!userPaused) player.playVideo(); }
      // the hum steps aside while music plays (and through the second of silence between two tracks)
      if (useRadio.getState().playing) lastHeard = now;
      radioMix.setPlaying(vol > 0 && now - lastHeard < 2500);
      if (now - lastProgress > 400) {
        lastProgress = now;
        const d = player.getDuration?.() || 0;
        const t = player.getCurrentTime?.() || 0;
        const pr = d > 0 ? Math.min(1, t / d) : 0;
        if (Math.abs(pr - useRadio.getState().progress) > 0.002) useRadio.getState().set({progress: pr});
      }
      if (useRadio.getState().playing && now - lastSave > 5000) { lastSave = now; save(); }
    }, 50);

    // The same tap or key that unlocks the TV's sound starts the music.
    const gesture = () => control.current?.tryStart();
    window.addEventListener('pointerdown', gesture, true);
    window.addEventListener('keydown', gesture, true);
    const unsubDirector = director.subscribe(() => { if (director.unlocked) control.current?.tryStart(); });

    return () => {
      dead = true;
      save();
      window.clearTimeout(readyTimer);
      window.clearInterval(loop);
      window.removeEventListener('pointerdown', gesture, true);
      window.removeEventListener('keydown', gesture, true);
      unsubDirector();
      radioMix.release('production');
      radioMix.release('cinema');
      radioMix.setPlaying(false);
      try { p?.destroy(); } catch { /* already gone */ }
      playerRef.current = null;
      control.current = null;
      if (hostRef.current) hostRef.current.innerHTML = '';
      useRadio.getState().set({playing: false, progress: 0, needsGesture: false});
    };
  }, [game]);

  // ---- remote: phones (through the server), media keys on a TV remote ---------------------------
  const command = useNet((s) => s.radioCommand);
  const seen = useRef(command?.seq ?? 0);
  useEffect(() => {
    if (!command || command.seq <= seen.current) return;
    seen.current = command.seq;
    if (!isSwitchAction(command.action)) control.current?.action(command.action);
  }, [command]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const a: RadioAction | null = e.key === 'MediaPlayPause' || e.key === 'MediaPlay' || e.key === 'MediaPause' ? 'toggle'
        : e.key === 'MediaTrackNext' ? 'next' : e.key === 'MediaTrackPrevious' ? 'prev' : null;
      if (!a) return;
      e.preventDefault();
      control.current?.action(a);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);

  // ---- tell the phones what is on ------------------------------------------------------------------
  const connected = useNet((s) => s.connected);
  useEffect(() => {
    if (!connected) return;
    const now: RadioNow = {enabled: true, on: status === 'ready', playing, videoId: track?.videoId ?? null, index: track?.index ?? 0,
      title: track?.title ?? '', artist: track?.artist ?? '', game: track?.game ?? null};
    useNet.getState().reportRadio(now);
  }, [connected, status, playing, track]);

  // ---- the track card: waits for a clear stage, holds ~6 s, gives way to anything bigger ---------------
  const clear = useStageClear();
  useEffect(() => {
    if (!pending) return;
    if (Date.now() - pending.at > CARD_WAIT_MS) { setPending(null); return; }
    if (!clear) {
      const t = setTimeout(() => setPending((p) => (p ? {...p} : p)), 500);
      return () => clearTimeout(t);
    }
    setCard({track: pending.track, key: Date.now()});
    setPending(null);
    wake();
  }, [pending, clear]);
  useEffect(() => {
    if (!card) return;
    const t = setTimeout(() => setCard(null), CARD_MS);
    return () => clearTimeout(t);
  }, [card]);
  useEffect(() => { if (!clear && card) setCard(null); }, [clear, card]);

  // Test handle (like window.__net): the player, the mix and the deck's state
  (window as unknown as {__radio?: unknown}).__radio = {player: playerRef, mix: radioMix, store: useRadio, action: (a: RadioAction) => control.current?.action(a),
    /** Tests: run the player's error path as if YouTube had reported `code` for the current track */
    error: (code: number) => control.current?.error(code)};

  const cinema = useCinema((s) => (s.current && !(s.current.kind === 'milestone' && s.current.milestone.endsWith('bonus')) ? s.current.kind : null));
  const lit = awake || needsGesture || !!card;
  const shown = status === 'ready' || status === 'loading';
  const deckRef = useRef<HTMLDivElement>(null);
  const [home, setHome] = useState<Place | null>(null);
  // where the deck ends (the log ticker starts after it) and where the window sits (for the glide aside)
  useEffect(() => {
    if (place !== PLACE.full) return;
    const el = deckRef.current;
    if (!el) return;
    const read = () => {
      const r = el.getBoundingClientRect();
      useRadio.getState().set({deckRight: Math.round(r.right)});
      setHome({...place, right: `${window.innerWidth - (r.left + 200)}px`, bottom: `${window.innerHeight - r.bottom}px`});
    };
    read();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(read);
    ro?.observe(el);
    window.addEventListener('resize', read);
    return () => { ro?.disconnect(); window.removeEventListener('resize', read); useRadio.getState().set({deckRight: null}); };
  }, [place]);
  if (place === PLACE.full) {
    const win = 200;
    return (
      <div ref={deckRef} data-radio="" data-radio-aside={cinema ? '' : undefined}
        style={{position: 'fixed', left: DECK_LEFT, bottom: DECK_BOTTOM, zIndex: 190, display: 'flex', alignItems: 'flex-end', gap: '0.8vw',
          opacity: shown ? 1 : 0, transition: 'opacity .6s', pointerEvents: 'none'}}
        onPointerEnter={wake} onPointerMove={wake} onFocus={wake}>
        {/* The YouTube player itself: the album window. Never covered, never smaller than 200×200. YouTube's own
            controls are off (playerVars); a clear sheet over it keeps hover and clicks from raising its title bar,
            play button or suggestions, and our controls beside it drive the player. */}
        <div data-radio-window="" style={{position: 'relative', flex: 'none', width: win, height: win, borderRadius: 8, overflow: 'hidden', background: '#000',
          boxShadow: `0 0 0 1px rgba(255,196,160,${lit ? 0.35 : 0.14}), 0 0.6vw 1.6vw rgba(0,0,0,.5)`, transform: cinema && home ? asideTransform(home, cinema) : 'none', pointerEvents: 'auto',
          transition: reduced ? 'box-shadow .6s' : 'box-shadow .6s, transform .9s cubic-bezier(.2,.9,.25,1)'}}>
          <div ref={hostRef} style={{position: 'absolute', inset: 0}} />
          <div data-radio-shield="" aria-hidden="true" onPointerDown={(e) => { e.preventDefault(); wake(); }}
            style={{position: 'absolute', inset: 0, zIndex: 1, background: 'transparent'}} />
        </div>
        <motion.div initial={false} animate={{opacity: cinema ? 0 : lit ? 1 : 0.62}} transition={{duration: reduced ? 0 : 0.6}}
          style={{display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '0.6vh', width: 'max(150px, 12vw)', pointerEvents: cinema ? 'none' : 'auto'}}>
          {track && (
            <div key={track.videoId} data-radio-title="" style={{fontSize: tvt(0.85), lineHeight: 1.2, color: 'var(--ice)', fontWeight: 600, overflow: 'hidden',
              display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical'}}>
              {track.title}
              {track.artist && <span className="cond" style={{display: 'block', fontWeight: 500, color: 'var(--ice-dim)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>{track.artist}</span>}
            </div>
          )}
          <Strip playing={playing} progress={progress} lit={lit} needsGesture={needsGesture} reduced={reduced} hidden={!!cinema} left
            onAction={(a) => control.current?.action(a)} />
        </motion.div>
      </div>
    );
  }
  return (
    <>
      <div data-radio="" data-radio-aside={cinema ? '' : undefined} style={{position: 'fixed', right: place.right, bottom: place.bottom, width: WINDOW, zIndex: 190,
        opacity: shown ? 1 : 0, transform: cinema ? asideTransform(place, cinema) : 'none',
        transition: reduced ? 'opacity .6s' : 'opacity .6s, transform .9s cubic-bezier(.2,.9,.25,1)'}}
        onPointerEnter={wake} onPointerMove={wake} onFocus={wake}>
        <Strip playing={playing} progress={progress} lit={lit} needsGesture={needsGesture} reduced={reduced} hidden={!!cinema}
          onAction={(a) => control.current?.action(a)} />
        {/* The YouTube player itself: the album window. Never covered, never smaller than 200×200. */}
        <div data-radio-window="" style={{position: 'relative', width: WINDOW, height: WINDOW, borderRadius: 6, overflow: 'hidden', background: '#000',
          boxShadow: `0 0 0 1px rgba(255,196,160,${lit ? 0.4 : 0.18}), 0 0.8vw 2vw rgba(0,0,0,.55)`, transition: 'box-shadow .6s'}}>
          <div ref={hostRef} style={{position: 'absolute', inset: 0}} />
        </div>
      </div>
      <AnimatePresence>
        {card && <TrackCard key={card.key} track={card.track} place={place} reduced={reduced} />}
      </AnimatePresence>
    </>
  );
}

/** Nothing bigger on screen: no cinematic, production show, caption, companion moment, flick or story. */
function useStageClear(): boolean {
  const cinema = useCinema((s) => !!s.current || s.queue.some((c) => !(c.kind === 'milestone' && c.milestone.endsWith('bonus'))));
  const show = useNet((s) => s.production);
  const [showLive, setShowLive] = useState(false);
  useEffect(() => {
    if (!show) { setShowLive(false); return; }
    const end = show.localStart + show.durationMs + 600;
    setShowLive(Date.now() < end);
    const t = setTimeout(() => setShowLive(false), Math.max(0, end - Date.now()));
    return () => clearTimeout(t);
  }, [show]);
  const busy = useStage((s) => s.caption || s.moment || s.flick || s.story || s.podium);
  return !cinema && !showLive && !busy;
}

// ---- the control strip ---------------------------------------------------------------------------
function Strip({playing, progress, lit, needsGesture, reduced, hidden, onAction, left}: {
  playing: boolean; progress: number; lit: boolean; needsGesture: boolean; reduced: boolean; hidden: boolean; onAction: (a: RadioAction) => void; left?: boolean;
}) {
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const onKey = (e: React.KeyboardEvent) => {
    const i = buttons.current.findIndex((b) => b === document.activeElement);
    if (e.key === 'ArrowRight' && i >= 0 && i < 2) { buttons.current[i + 1]?.focus(); e.preventDefault(); e.stopPropagation(); }
    else if (e.key === 'ArrowLeft' && i > 0) { buttons.current[i - 1]?.focus(); e.preventDefault(); e.stopPropagation(); }
    // back to the dock: the options gear sits left of the radio (the sound toggle above it)
    else if (e.key === 'ArrowLeft' && i === 0) { document.querySelector<HTMLElement>('[data-tv-options] button')?.focus(); e.preventDefault(); e.stopPropagation(); }
    else if (e.key === 'Escape' || e.key === 'Backspace' || e.key === 'GoBack') { (document.activeElement as HTMLElement | null)?.blur(); e.preventDefault(); }
  };
  const btn = (a: RadioAction, i: number, label: string, icon: React.ReactNode, big = false) => (
    <button key={a} ref={(el) => { buttons.current[i] = el; }} aria-label={label} className="tv-focus" data-radio-button={a}
      onClick={(e) => { e.stopPropagation(); onAction(a); }}
      style={{width: big ? '2vw' : '1.65vw', height: big ? '2vw' : '1.65vw', minWidth: big ? 36 : 30, minHeight: big ? 36 : 30, borderRadius: 999,
        display: 'grid', placeItems: 'center', color: 'var(--ice)', background: big ? 'rgba(234,242,244,.14)' : 'transparent'}}>
      {icon}
    </button>
  );
  return (
    <motion.div data-radio-strip="" onKeyDown={onKey} initial={false} animate={{opacity: hidden ? 0 : lit ? 1 : 0.62}} transition={{duration: reduced ? 0 : 0.6}}
      style={{position: 'relative', width: 'fit-content', marginLeft: left ? 0 : 'auto', pointerEvents: hidden ? 'none' : 'auto', marginBottom: left ? 0 : '0.4vw', padding: '0.2vw 0.45vw 0.3vw 0.6vw', borderRadius: '0.7vw',
        display: 'flex', gap: '0.6vw', alignItems: 'center',
        background: 'linear-gradient(180deg, rgba(36,19,15,.92), rgba(20,10,8,.92))', boxShadow: 'inset 0 0 0 1px var(--rim-strong), 0 0.4vw 1.2vw rgba(0,0,0,.4)'}}>
      <Meter playing={playing} reduced={reduced} needsGesture={needsGesture} />
      <div style={{display: 'flex', alignItems: 'center', gap: '0.35vw'}}>
        {btn('prev', 0, 'Previous track', <svg viewBox="0 0 24 24" width="58%" height="58%" aria-hidden="true"><path fill="currentColor" d="M6 5h2.2v14H6zM19 5.6v12.8L9.6 12z" /></svg>)}
        {btn('toggle', 1, playing ? 'Pause the radio' : 'Play the radio', playing
          ? <svg viewBox="0 0 24 24" width="50%" height="50%" aria-hidden="true"><path fill="currentColor" d="M6.5 5h3.8v14H6.5zm7.2 0h3.8v14h-3.8z" /></svg>
          : <svg viewBox="0 0 24 24" width="52%" height="52%" aria-hidden="true"><path fill="currentColor" d="M7.5 4.8v14.4L19.4 12z" /></svg>, true)}
        {btn('next', 2, 'Next track', <svg viewBox="0 0 24 24" width="58%" height="58%" aria-hidden="true"><path fill="currentColor" d="M15.8 5H18v14h-2.2zM5 5.6v12.8L14.4 12z" /></svg>)}
      </div>
      {/* progress: a thin line along the strip's foot */}
      <div style={{position: 'absolute', left: '0.8vw', right: '0.8vw', bottom: 3, height: 2, borderRadius: 2, background: 'rgba(234,242,244,.12)', overflow: 'hidden'}}>
        <div data-radio-progress={progress.toFixed(3)} style={{width: '100%', height: '100%', background: 'var(--mc)', transformOrigin: 'left', transform: `scaleX(${progress})`, transition: 'transform .45s linear'}} />
      </div>
    </motion.div>
  );
}

/** Three small bars that move while music plays (still when reduced motion is asked for). */
function Meter({playing, reduced, needsGesture}: {playing: boolean; reduced: boolean; needsGesture: boolean}) {
  const muted = useSyncExternalStore((l) => director.subscribe(l), () => director.muted);
  if (needsGesture && !muted) {
    return <span className="cond" style={{fontSize: tvt(0.62), lineHeight: 1.05, color: 'var(--ice-dim)', whiteSpace: 'nowrap'}}>Tap for<br />music</span>;
  }
  return (
    <div aria-hidden="true" style={{display: 'flex', alignItems: 'flex-end', gap: '0.18vw', height: '1vw', paddingLeft: '0.2vw'}}>
      {[0.55, 1, 0.75].map((h, i) => (
        <motion.span key={i} initial={false}
          animate={playing && !reduced ? {scaleY: [h, 1, h * 0.5, h]} : {scaleY: playing ? h : 0.25}}
          transition={playing && !reduced ? {duration: 1.1, repeat: Infinity, delay: i * 0.18, ease: 'easeInOut'} : {duration: 0.3}}
          style={{display: 'block', width: '0.22vw', minWidth: 3, height: '100%', borderRadius: 2, background: 'var(--mc)', transformOrigin: 'bottom', opacity: 0.85}} />
      ))}
    </div>
  );
}

// ---- the track card ------------------------------------------------------------------------------
function TrackCard({track, place, reduced}: {track: Track; place: Place; reduced: boolean}) {
  const sub = [track.artist, track.game].filter(Boolean).join(' · ');
  return (
    <motion.div data-radio-card="" data-video-id={track.videoId}
      initial={reduced ? {opacity: 0} : place.card.from === 'right' ? {opacity: 0, x: '2.2vw'} : {opacity: 0, y: '2vh'}} animate={{opacity: 1, x: 0, y: 0}}
      exit={reduced ? {opacity: 0} : place.card.from === 'right' ? {opacity: 0, x: '1.4vw'} : {opacity: 0, y: '1.2vh'}}
      transition={{duration: reduced ? 0.3 : 0.55, ease: [0.2, 0.9, 0.25, 1]}}
      style={{position: 'fixed', zIndex: 189, bottom: place.card.bottom, right: place.card.right,
        display: 'flex', alignItems: 'center', gap: '0.9vw', maxWidth: '24vw', height: '7.2vh', padding: '0.7vh 1.1vw 0.7vh 0.7vh', borderRadius: '0.9vw',
        background: 'linear-gradient(90deg, rgba(20,10,8,.95), rgba(36,19,15,.95))', boxShadow: 'inset 0 0 0 1px var(--rim-strong), 0 1vw 2.4vw rgba(0,0,0,.5)', pointerEvents: 'none'}}>
      {/* the still: the centre square of YouTube's 4:3 thumbnail, which is the album art of a "Topic" track */}
      <div aria-hidden="true" style={{height: '100%', aspectRatio: '1', flex: 'none', borderRadius: '0.5vw',
        background: `#000 url(${thumbnailUrl(track.videoId)}) center / 177.8% auto no-repeat`}} />
      <div style={{minWidth: 0}}>
        <div style={{fontSize: tvt(1.05), fontWeight: 700, lineHeight: 1.15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}} data-radio-title="">{track.title}</div>
        {sub && <div className="cond" style={{fontSize: tvt(0.85), lineHeight: 1.2, color: 'var(--ice-dim)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}} data-radio-sub="">{sub}</div>}
      </div>
    </motion.div>
  );
}
