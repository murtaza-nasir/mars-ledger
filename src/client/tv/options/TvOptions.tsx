// The TV's options: a quiet gear in the bottom-left corner that opens a panel for sound and text size.
// Built for a TV remote first: arrows wake and focus the gear, OK opens it, Up/Down move between rows,
// Left/Right change a value, Back/Escape closes. A mouse works too.
import {AnimatePresence, motion} from 'motion/react';
import {Fragment, useEffect, useRef, useState, useSyncExternalStore} from 'react';
import {director} from '../sound/director';
import {DOCK_BOTTOM, DOCK_LEFT} from '../dock';
import {setSettings, TEXT_SIZE_LABEL, TEXT_SIZES, TILE_STYLE_LABEL, TILE_STYLES, tileStyleOf, tvt, useTvSettings} from '../settings';
import type {TvSettings} from '../settings';
import {clearBoardFallback, fallbackReason, useBoardFallback} from '../full/board3d/fallback';
import type {FallbackReason} from '../full/board3d/fallback';
import {LEVELS, resetLadder, useQuality} from '../full/board3d/quality';
import type {LevelReason} from '../full/board3d/quality';
import {reportTv3d, tvId} from '../full/board3d/report';
import {useRadioNotice} from '../radio/store';
import {useNet} from '../../net';
import {useMissionStatus} from '../narrator/status';
import {REST_TILT_DEG, REST_ZOOM} from '../full/board3d/camera3d';
import {startFlying, stopFlying, useFly, useRestInfo} from '../full/board3d/flyStore';

/** `group`: a heading shown above the row (the experimental features sit under one at the end); `sub`: the row belongs
 *  to the switch above it (indented, and disabled while that switch is off). */
type Head = {group?: string; groupNote?: string; sub?: boolean};
type Row = Head & (
  | {kind: 'switch'; id: string; label: string; on: boolean; set: (v: boolean) => void; disabled?: boolean; note?: string | null}
  // volumes run 0..1 in tenths and show as percentages; other sliders give their own range, step and format
  | {kind: 'slider'; id: string; label: string; value: number; set: (v: number) => void; disabled?: boolean; note?: string | null;
      min?: number; max?: number; step?: number; format?: (v: number) => string}
  | {kind: 'choice'; id: string; label: string; value: string; options: Array<{value: string; label: string}>; set: (v: string) => void; disabled?: boolean; note?: string | null}
  | {kind: 'button'; id: string; label: string; text: string; run: () => void; disabled?: boolean; note?: string | null});

const STEP = 0.1;
const pct = (v: number) => `${Math.round(v * 100)}%`;

export function TvOptions() {
  const [open, setOpen] = useState(false);
  const [awake, setAwake] = useState(false);
  const gear = useRef<HTMLButtonElement>(null);
  const sleep = useRef<number | undefined>(undefined);

  // Wake the gear on any pointer movement or key; arrows also give it focus so a remote can reach it.
  useEffect(() => {
    const wake = () => {
      setAwake(true);
      window.clearTimeout(sleep.current);
      sleep.current = window.setTimeout(() => setAwake(false), 4000);
    };
    const key = (e: KeyboardEvent) => {
      wake();
      if (open) return;
      if (e.key.startsWith('Arrow') && (document.activeElement as HTMLElement | null)?.closest('[data-radio]')) return;
      // the dock: the sound toggle above the gear (Up and Down between them), the radio to the right of both
      const sound = document.querySelector<HTMLElement>('[data-sound-toggle]');
      if (e.key === 'ArrowUp' && document.activeElement === gear.current && sound) { sound.focus(); e.preventDefault(); return; }
      if (sound && document.activeElement === sound) {
        if (e.key === 'ArrowRight') {
          const radio = document.querySelector<HTMLElement>('[data-radio-button="toggle"]');
          if (radio) radio.focus();
          e.preventDefault(); return;
        }
        if (e.key === 'ArrowDown') { gear.current?.focus(); e.preventDefault(); return; }
        if (e.key.startsWith('Arrow')) { e.preventDefault(); return; }
      }
      if (e.key === 'ArrowRight' && document.activeElement === gear.current) {
        const radio = document.querySelector<HTMLElement>('[data-radio-button="toggle"]');
        if (radio) { radio.focus(); e.preventDefault(); return; }
      }
      if (e.key.startsWith('Arrow') && document.activeElement !== gear.current) { gear.current?.focus(); e.preventDefault(); }
    };
    window.addEventListener('pointermove', wake);
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('pointermove', wake); window.removeEventListener('keydown', key); window.clearTimeout(sleep.current); };
  }, [open]);

  return (
    <div data-tv-options="" style={{position: 'fixed', left: DOCK_LEFT, bottom: DOCK_BOTTOM, zIndex: 210}}>
      <motion.button ref={gear} aria-label="TV options" aria-haspopup="dialog" aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        animate={{opacity: open || awake ? 0.95 : 0.22}} transition={{duration: 0.4}}
        className="tv-focus"
        style={{width: '2.1vw', height: '2.1vw', minWidth: 30, minHeight: 30, borderRadius: 999, display: 'grid', placeItems: 'center',
          background: 'rgba(12,5,3,.55)', color: 'var(--ice)'}}>
        <svg viewBox="0 0 24 24" width="62%" height="62%" aria-hidden="true">
          <path fill="currentColor" d="M19.4 13a7.6 7.6 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.4 7.4 0 0 0-1.7-1L15 3.5h-4L10.7 6a7.4 7.4 0 0 0-1.7 1l-2.4-1-2 3.4L6.6 11a7.6 7.6 0 0 0 0 2l-2 1.6 2 3.4 2.4-1c.5.4 1.1.7 1.7 1l.3 2.5h4l.3-2.5c.6-.3 1.2-.6 1.7-1l2.4 1 2-3.4zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z" transform="translate(-1 0)" />
        </svg>
      </motion.button>
      <AnimatePresence>{open && <Panel onClose={() => { setOpen(false); gear.current?.focus(); }} />}</AnimatePresence>
    </div>
  );
}

function Panel({onClose}: {onClose: () => void}) {
  const s = useTvSettings();
  const muted = useSyncExternalStore((l) => director.subscribe(l), () => director.muted);
  const fellBack = useBoardFallback();
  const quality = useQuality();
  const radioNotice = useRadioNotice();
  const radioOn = useNet((x) => !!x.config?.radioPlaylist);
  const mission = useMissionStatus();
  const set = (patch: Partial<TvSettings>) => setSettings(patch);
  const rest = useRestInfo((x) => x.info);
  const flying = useFly((x) => x.phase === 'flying');
  const no3d = !s.board3d || fellBack;
  const zoom = s.boardZoom ?? 1;
  const tilt = s.boardTilt ?? rest?.autoTilt ?? 32;
  const rows: Row[] = [
    {kind: 'switch', id: 'sound', label: 'Sound', on: !muted, set: (v) => director.setMuted(!v)},
    {kind: 'slider', id: 'master', label: 'Volume', value: s.master, set: (v) => set({master: v}), disabled: muted},
    {kind: 'switch', id: 'hum', label: 'Background hum', on: s.hum, set: (v) => set({hum: v}), disabled: muted},
    {kind: 'slider', id: 'humVolume', label: 'Hum volume', value: s.humVolume, set: (v) => set({humVolume: v}), disabled: muted || !s.hum},
    {kind: 'slider', id: 'effects', label: 'Effects volume', value: s.effects, set: (v) => set({effects: v}), disabled: muted},
    {kind: 'slider', id: 'voice', label: 'Mission control voice', value: s.voice, set: (v) => set({voice: v}), disabled: muted, note: mission},
    {kind: 'choice', id: 'text', label: 'Text size', value: s.textSize, options: TEXT_SIZES.map((t) => ({value: t, label: TEXT_SIZE_LABEL[t]})),
      set: (v) => set({textSize: v as TvSettings['textSize']})},
    {kind: 'switch', id: 'weather', label: 'Weather and light effects', on: s.weather, set: (v) => set({weather: v})},
    {kind: 'switch', id: 'board3d', label: fellBack ? '3D board (paused: too slow here)' : '3D board', on: s.board3d && !fellBack,
      set: (v) => { if (v) clearBoardFallback(); set({board3d: v}); }, note: fallbackNote(fallbackReason(), fellBack)},
    {kind: 'choice', id: 'tileStyle', label: 'Tile style', value: tileStyleOf(s), options: TILE_STYLES.map((t) => ({value: t, label: TILE_STYLE_LABEL[t]})),
      set: (v) => set({tileStyle: v as TvSettings['tileStyle']}), disabled: !s.board3d || fellBack},
    // how much this screen's 3D board draws: it steps down by itself when frames stay slow (board3d/quality.ts)
    {kind: 'button', id: 'quality', label: `3D: ${LEVELS[fellBack ? LEVELS.length - 1 : quality.level].label}${quality.level > 0 || fellBack ? ' (slow frames)' : ''}`,
      text: 'Reset to full', disabled: !s.board3d || (quality.level === 0 && !fellBack), note: qualityNote(quality.level, quality.reason, fellBack),
      run: () => { resetLadder(); clearBoardFallback(); reportTv3d({level: 0, dir: 'reset', p95: null, median: null, slow: null, render: null,
        size: `${window.innerWidth}x${window.innerHeight}@${Math.round(window.devicePixelRatio * 100) / 100}`}); }},
    {kind: 'switch', id: 'trTrack', label: 'TR track', on: s.trTrack, set: (v) => set({trTrack: v}), note: 'Numbered squares round the edge of the screen, a token for each player'},
    {kind: 'switch', id: 'cameraMoves', label: 'Camera moves', on: s.cameraMoves, set: (v) => set({cameraMoves: v})},
    // Board life is the master switch; Terraformers (its characters) sits under it: the sky drops and the ambient life run without them
    {kind: 'switch', id: 'boardLife', label: 'Board life', on: s.boardLife, set: (v) => set({boardLife: v}), disabled: no3d,
      note: 'Tiny people, rovers and surprises on the empty land'},
    {kind: 'switch', id: 'terraformers', label: 'Terraformers', on: s.terraformers, set: (v) => set({terraformers: v}), disabled: no3d || !s.boardLife, sub: true,
      note: s.boardLife ? 'The little characters and their scenes' : 'Needs Board life'},
    // the radio only when the server has a playlist (RADIO_PLAYLIST)
    ...(radioOn ? [
      {kind: 'switch', id: 'radio', label: 'Radio', on: s.radio, set: (v: boolean) => set({radio: v}), note: s.radio ? radioNotice : null},
      {kind: 'slider', id: 'radioVolume', label: 'Radio volume', value: s.radioVolume, set: (v: number) => set({radioVolume: v}), disabled: muted || !s.radio},
    ] as Row[] : []),
    // experimental: features that may or may not stay; each one off leaves the board as it always is
    {kind: 'switch', id: 'boardView', label: 'Adjust board zoom and tilt', on: s.boardView, set: (v) => set({boardView: v}), disabled: no3d,
      group: 'Experimental', groupNote: 'Features we are trying out. They may change or go away.'},
    {kind: 'slider', id: 'boardZoom', label: 'Board zoom', value: zoom, min: REST_ZOOM.min, max: REST_ZOOM.max, step: REST_ZOOM.step,
      format: (v) => `${Math.round(v * 100)}%`, set: (v) => set({boardZoom: v}), disabled: no3d || !s.boardView,
      note: s.boardView && rest?.zoom !== null && rest?.zoom !== undefined && rest.zoom < zoom - 0.004 ? `Held at ${Math.round(rest.zoom * 100)}% so the board stays on screen` : null},
    {kind: 'slider', id: 'boardTilt', label: 'Board tilt', value: tilt, min: REST_TILT_DEG.min, max: REST_TILT_DEG.max, step: REST_TILT_DEG.step,
      format: (v) => `${Math.round(v)}°`, set: (v) => set({boardTilt: v}), disabled: no3d || !s.boardView,
      note: s.boardTilt === null ? 'Automatic' : null},
    {kind: 'button', id: 'boardReset', label: 'Zoom and tilt', text: 'Reset to automatic', run: () => set({boardZoom: null, boardTilt: null}),
      disabled: no3d || !s.boardView || (s.boardZoom === null && s.boardTilt === null)},
    {kind: 'switch', id: 'fly', label: 'Fly over Mars', on: s.fly, set: (v) => set({fly: v}), disabled: no3d,
      note: s.fly ? 'Press F, use a gamepad, or use Fly the TV camera in a phone’s game menu' : null},
    {kind: 'switch', id: 'flyBank', label: 'Bank into turns', on: s.flyBank, set: (v) => set({flyBank: v}), disabled: no3d || !s.fly},
    {kind: 'button', id: 'flyGo', label: 'Flight', text: flying ? 'Stop flying' : 'Start flying', disabled: no3d || !s.fly,
      run: () => { if (flying) stopFlying('stop'); else { onClose(); startFlying(null); } }},
  ];
  const [focus, setFocus] = useState(0);
  const refs = useRef<Array<HTMLDivElement | null>>([]);
  const panel = useRef<HTMLDivElement>(null);
  // The remote's row scrolls into view when the panel is taller than the screen (TV browsers often lay the page out
  // at 960×540 or 1280×720); on the last stop (Close) the hint line under it shows too.
  useEffect(() => {
    const el = refs.current[focus];
    if (!el) return;
    el.focus({preventScroll: true});
    el.scrollIntoView({block: 'nearest'});
    if (focus === rows.length && panel.current) panel.current.scrollTop = panel.current.scrollHeight;
  }, [focus, rows.length]);
  // Back/Escape closes from anywhere, even if focus has wandered out of the panel.
  useEffect(() => {
    const back = (e: KeyboardEvent) => {
      if (['Escape', 'GoBack', 'BrowserBack'].includes(e.key)) { e.preventDefault(); onClose(); }
    };
    window.addEventListener('keydown', back);
    return () => window.removeEventListener('keydown', back);
  }, [onClose]);

  const adjust = (r: Row, dir: -1 | 1) => {
    if ('disabled' in r && r.disabled) return;
    if (r.kind === 'switch') r.set(dir > 0);
    else if (r.kind === 'slider') {
      if (r.min === undefined) r.set(Math.round(Math.min(1, Math.max(0, r.value + dir * STEP)) * 10) / 10);
      else { const st = r.step ?? 0.1; r.set(Math.round(Math.min(r.max ?? 1, Math.max(r.min, r.value + dir * st)) / st) * st); }
    } else if (r.kind === 'button') return;
    else {
      const i = r.options.findIndex((o) => o.value === r.value);
      r.set(r.options[Math.min(r.options.length - 1, Math.max(0, i + dir))].value);
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    const r = rows[focus];
    const k = e.key;
    if (k === 'ArrowDown') setFocus((f) => Math.min(rows.length, f + 1));
    else if (k === 'ArrowUp') setFocus((f) => Math.max(0, f - 1));
    else if (k === 'ArrowLeft' && r) adjust(r, -1);
    else if (k === 'ArrowRight' && r) adjust(r, 1);
    else if ((k === 'Enter' || k === ' ') && r && r.kind === 'switch' && !r.disabled) r.set(!r.on);
    else if ((k === 'Enter' || k === ' ') && r && r.kind === 'button' && !r.disabled) r.run();
    else if (k === 'Backspace') onClose();
    else if (k === 'Escape' || k === 'GoBack' || k === 'BrowserBack') return; // handled on window
    else return;
    e.preventDefault(); e.stopPropagation();
  };

  return (
    <motion.div ref={panel} role="dialog" aria-label="TV options" data-tv-scroll="" onKeyDown={onKey} onClick={(e) => e.stopPropagation()}
      initial={{opacity: 0, y: 14, scale: 0.98}} animate={{opacity: 1, y: 0, scale: 1}} exit={{opacity: 0, y: 10, scale: 0.98}}
      transition={{type: 'spring', stiffness: 320, damping: 30}}
      style={{position: 'absolute', left: 0, bottom: 'calc(2.1vw + 1.4vh)', width: 'min(60vw, calc(31vw * var(--tvt, 1)))', minWidth: 460, padding: '1.6vw 1.8vw 1.2vw',
        maxHeight: 'calc(100vh - 2.1vw - 4vh)', overflowY: 'auto', overscrollBehavior: 'contain',
        borderRadius: '1.2vw', background: 'linear-gradient(180deg, rgba(52,26,20,.97), rgba(26,13,10,.97))',
        boxShadow: '0 0 0 1px var(--rim-strong), 0 2vw 4vw rgba(0,0,0,.55)', color: 'var(--ice)'}}>
      <div style={{display: 'flex', alignItems: 'baseline', marginBottom: '1.2vh'}}>
        <h2 style={{margin: 0, flex: 1, fontSize: tvt(1.5), fontWeight: 750, fontVariationSettings: "'wdth' 85"}}>TV options</h2>
        <span className="faint cond" style={{fontSize: tvt(0.9)}}>For this screen</span>
      </div>
      {/* what this browser reports: the radio's window is a fixed 200 CSS px (YouTube's minimum), so a TV browser that
          renders its page at a low resolution makes it look large; this line tells which. It sits under the title so it
          shows even when the panel is taller than the screen and scrolls. */}
      <p className="faint" data-screen="" style={{margin: '-0.6vh 0.2vw 1vh', fontSize: tvt(0.85)}}>
        Screen: {window.innerWidth}×{window.innerHeight} page pixels, {Math.round(window.devicePixelRatio * 100) / 100}× density ({Math.round(window.innerWidth * window.devicePixelRatio)}×{Math.round(window.innerHeight * window.devicePixelRatio)} device) · TV {tvId()}
      </p>
      <div style={{display: 'grid', gap: '0.3vh'}}>
        {rows.map((r, i) => (<Fragment key={r.id}>
          {r.group && (
            <div data-group={r.group} style={{margin: '1.6vh 0.9vw 0.4vh', paddingTop: '1.2vh', borderTop: '1px solid var(--rim)'}}>
              <div style={{fontSize: tvt(1.15), fontWeight: 750, fontVariationSettings: "'wdth' 85"}}>{r.group}</div>
              {r.groupNote && <div className="faint" style={{fontSize: tvt(0.85)}}>{r.groupNote}</div>}
            </div>
          )}
          <div ref={(el) => { refs.current[i] = el; }} tabIndex={0} data-row={r.id} className="tv-focus"
            role={r.kind === 'switch' ? 'switch' : r.kind === 'slider' ? 'slider' : r.kind === 'button' ? 'button' : 'radiogroup'}
            aria-label={r.kind === 'button' ? r.text : r.label} aria-checked={r.kind === 'switch' ? r.on : undefined}
            aria-valuenow={r.kind === 'slider' ? (r.min === undefined ? Math.round(r.value * 100) : r.value) : undefined}
            aria-valuemin={r.kind === 'slider' ? (r.min === undefined ? 0 : r.min) : undefined}
            aria-valuemax={r.kind === 'slider' ? (r.min === undefined ? 100 : r.max) : undefined}
            aria-valuetext={r.kind === 'slider' && r.format ? r.format(r.value) : undefined} aria-disabled={'disabled' in r && r.disabled ? true : undefined}
            onFocus={() => setFocus(i)}
            style={{display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) calc(14vw * var(--tvt, 1))', alignItems: 'center', gap: '1.2vw', padding: '0.7vh 0.9vw', borderRadius: '0.7vw',
              background: focus === i ? 'rgba(255,255,255,.07)' : 'transparent', opacity: 'disabled' in r && r.disabled ? 0.42 : 1, outline: 'none'}}>
            <span style={{fontSize: tvt(1.1), fontWeight: 600, whiteSpace: 'nowrap', paddingLeft: r.sub ? '1.4vw' : undefined}}>{r.sub && <span aria-hidden="true" className="faint">└ </span>}{r.label}
              {r.note && <span data-note="" className="faint" style={{display: 'block', fontSize: tvt(0.85), fontWeight: 500, whiteSpace: 'normal'}}>{r.note}</span>}</span>
            <Control r={r} />
          </div>
        </Fragment>))}
        <button ref={(el) => { refs.current[rows.length] = el as unknown as HTMLDivElement; }} className="btn ghost tv-focus" onFocus={() => setFocus(rows.length)}
          onClick={onClose} style={{marginTop: '1vh', minHeight: '2.6vw', fontSize: tvt(1.05)}}>Close</button>
      </div>
      <p className="faint" style={{margin: '1vh 0.2vw 0', fontSize: tvt(0.9)}}>Arrows move and change values · OK switches · Back closes</p>
    </motion.div>
  );
}

/** Why the 3D board last switched itself off on this screen, in plain words (kept after it is turned back on). */
function fallbackNote(why: FallbackReason | null, now: boolean): string | null {
  if (!why) return null;
  const when = new Date(why.at).toLocaleString([], {weekday: 'short', hour: 'numeric', minute: '2-digit'});
  const lead = now ? `Switched off ${when}` : `Last switched off ${when}`;
  if (why.kind === 'error') return `${lead} after a graphics error: ${why.message.slice(0, 120)}`;
  return `${lead}: frames took ${Math.round(why.p95)} ms (slowest 5%), ${Math.round(why.median)} ms typical, ${Math.round(why.gaps * 100)}% held back (screen ${why.size})`;
}

/** What the quality ladder did on this screen, in plain words: when it last stepped, what the frames measured. */
function qualityNote(level: number, why: LevelReason | null, flat: boolean): string | null {
  if (flat) return 'Every lighter 3D level was still too slow here. Turn the 3D board back on, or reset to full.';
  if (level === 0) return why?.dir === 'up' ? 'Back to full after a slow spell' : null;
  const back = 'Comes back by itself when frames have room.';
  if (!why) return back;
  const when = new Date(why.at).toLocaleString([], {weekday: 'short', hour: 'numeric', minute: '2-digit'});
  return `Since ${when}: frames took ${Math.round(why.p95)} ms (slowest 5%) at ${why.size.replace('x', '×').replace('@', ' at ')}×. ${back}`;
}

function Control({r}: {r: Row}) {
  if (r.kind === 'switch') {
    return (
      <button aria-hidden="true" tabIndex={-1} onClick={() => !r.disabled && r.set(!r.on)}
        style={{justifySelf: 'end', position: 'relative', width: '3.4vw', height: '1.9vw', minWidth: 46, minHeight: 26, borderRadius: 999,
          background: r.on ? 'var(--mc)' : 'rgba(255,255,255,.16)', transition: 'background .2s'}}>
        <motion.span animate={{left: r.on ? '52%' : '6%'}} transition={{type: 'spring', stiffness: 500, damping: 32}}
          style={{position: 'absolute', top: '12%', width: '42%', height: '76%', borderRadius: 999, background: r.on ? '#2A1A04' : 'var(--ice)'}} />
      </button>
    );
  }
  if (r.kind === 'slider') return <Slider value={r.value} disabled={r.disabled} onChange={r.set} min={r.min} max={r.max} step={r.step} format={r.format} />;
  if (r.kind === 'button') {
    return (
      <button tabIndex={-1} onClick={() => !r.disabled && r.run()} className="btn ghost"
        style={{justifySelf: 'stretch', minHeight: '2.2vw', padding: '0.4vh 0.8vw', fontSize: tvt(0.95), whiteSpace: 'nowrap'}}>{r.text}</button>
    );
  }
  return (
    <div style={{display: 'flex', gap: '0.3vw', padding: '0.25vw', borderRadius: '0.6vw', background: 'rgba(255,255,255,.06)'}}>
      {r.options.map(({value: t, label}) => (
        <button key={t} tabIndex={-1} aria-pressed={r.value === t} onClick={() => !r.disabled && r.set(t)}
          style={{flex: 1, padding: '0.6vh 0.3vw', borderRadius: '0.45vw', fontSize: tvt(0.95), fontWeight: 650, fontVariationSettings: "'wdth' 72", whiteSpace: 'nowrap',
            background: r.value === t ? 'var(--ice)' : 'transparent', color: r.value === t ? 'var(--dusk-1)' : 'var(--ice-dim)'}}>
          {label}
        </button>
      ))}
    </div>
  );
}

function Slider({value, disabled, onChange, min, max = 1, step, format = pct}: {value: number; disabled?: boolean; onChange: (v: number) => void;
  min?: number; max?: number; step?: number; format?: (v: number) => string}) {
  const track = useRef<HTMLDivElement>(null);
  const lo = min ?? 0;
  const from = (x: number) => {
    const r = track.current!.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (x - r.left) / r.width));
    if (min === undefined) onChange(Math.round(f * 20) / 20);
    else { const st = step ?? 0.05; onChange(Math.round((lo + f * (max - lo)) / st) * st); }
  };
  const frac = Math.min(1, Math.max(0, (value - lo) / (max - lo)));
  return (
    <div style={{display: 'flex', alignItems: 'center', gap: '0.8vw'}}>
      <div ref={track} onPointerDown={(e) => { if (disabled) return; (e.target as Element).setPointerCapture?.(e.pointerId); from(e.clientX); }}
        onPointerMove={(e) => { if (!disabled && e.buttons) from(e.clientX); }}
        style={{position: 'relative', flex: 1, height: '1.6vw', minHeight: 22, margin: '0 0.6vw', cursor: disabled ? 'default' : 'pointer', touchAction: 'none'}}>
        <div style={{position: 'absolute', left: 0, right: 0, top: '50%', height: '0.35vw', minHeight: 4, transform: 'translateY(-50%)', borderRadius: 999, background: 'rgba(255,255,255,.14)'}} />
        <motion.div initial={false} animate={{width: `${frac * 100}%`}} transition={{type: 'spring', stiffness: 400, damping: 36}}
          style={{position: 'absolute', left: 0, top: '50%', height: '0.35vw', minHeight: 4, transform: 'translateY(-50%)', borderRadius: 999, background: 'var(--mc)'}} />
        <motion.div initial={false} animate={{left: `${frac * 100}%`}} transition={{type: 'spring', stiffness: 400, damping: 36}}
          style={{position: 'absolute', top: '50%', width: '1.1vw', height: '1.1vw', minWidth: 16, minHeight: 16, borderRadius: 999, background: 'var(--ice)',
            transform: 'translate(-50%, -50%)', boxShadow: '0 2px 6px rgba(0,0,0,.4)'}} />
      </div>
      <span className="num" style={{width: 'calc(3.8vw * var(--tvt, 1))', flex: 'none', textAlign: 'right', fontSize: tvt(1)}}>{format(value)}</span>
    </div>
  );
}
