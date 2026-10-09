// Mounts the TV's sound: listens to the table and plays cues, shows the unlock chip and mute toggle.
import {AnimatePresence, motion} from 'motion/react';
import {useEffect, useSyncExternalStore} from 'react';
import type {SpectatorModel} from '../../../shared/full';
import {useNet} from '../../net';
import {companionCues, fullCues, progressOf} from './cues';
import {director} from './director';
import {sequencedBy} from '../full/pipeline/sequence';
import {wasFlicked} from '../table/flicks';
import {buildBus, levelsFor, play, production} from './synth';
import type {Sfx} from './synth';
import {tvt} from '../settings';
import {DOCK_BUTTON, SOUND_BOTTOM, SOUND_CHIP_INSET, SOUND_LEFT} from '../dock';
import {clearOfFrame} from '../full/trTrack';

/** Whether the "tap for sound" chip is on screen (other bottom-lane content keeps clear of it). */
export function useSoundChipVisible(): boolean {
  return useSyncExternalStore((l) => director.subscribe(l), () => !director.unlocked && !director.muted);
}

/** Right inset for bottom-lane content: clear of the "tap for sound" chip while it shows (the speaker button sits in
 *  the bottom-left dock, beside the options gear, so otherwise the lane runs to the right edge). */
export function useBottomLaneRight(): string {
  return useSoundChipVisible() ? '22vw' : clearOfFrame('2vw');
}

export function SoundLayer() {
  const snap = useSyncExternalStore((l) => director.subscribe(l), () => `${director.unlocked}|${director.muted}`);
  const [unlocked, muted] = snap.split('|').map((x) => x === 'true');

  useEffect(() => {
    const unlock = () => director.unlock();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'm' || e.key === 'M') director.setMuted(!director.muted);
      else director.unlock();
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', key); };
  }, []);

  useEffect(() => {
    let prevModel: SpectatorModel | null = null;
    let lastSeq = useNet.getState().lastTick?.seq ?? 0;
    let lastHover: Record<string, string | null> = {};
    const onState = (s: ReturnType<typeof useNet.getState>, prev: ReturnType<typeof useNet.getState>) => {
      // ambient follows how terraformed Mars is
      const model = s.fullView?.role === 'spectator' ? s.fullView.model : null;
      if (s.state?.mode === 'full' && model) director.setProgress(progressOf({temperature: model.game.temperature, oxygen: model.game.oxygenLevel, oceans: model.game.oceans}));
      else if (s.state) director.setProgress(progressOf(s.state.global));

      // companion: the engine's events for each move
      if (s.lastTick && s.lastTick.seq > lastSeq && s.lastTick !== prev.lastTick) {
        lastSeq = s.lastTick.seq;
        if (s.state?.mode !== 'full') for (const c of companionCues(s.lastTick.events)) director.cue(c.sfx, c.level);
      }
      // full: compare consecutive spectator models
      if (model && model !== prevModel) {
        if (prevModel && prevModel.id === model.id) {
          // played cards, their tiles and the attack after them sound as the TV presents them (pipeline/CardStage)
          const seq = sequencedBy(prevModel, model, wasFlicked);
          const skip = {cards: new Set(seq.cards), tiles: new Set(seq.tiles.keys()), attack: seq.cards.length > 0};
          for (const c of fullCues(prevModel, model, skip)) director.cue(c.sfx, c.level);
        }
        prevModel = model;
      }
      // full: the production showpiece
      if (s.production && s.production !== prev.production) {
        const units = s.production.players.reduce((a, p) => a + Object.values(p.gains).reduce((x, y) => x + Math.max(0, y), 0), 0);
        director.production(s.production.id, s.production.localStart, s.production.durationMs, Math.min(600, Math.round(units * 1.6)));
      }
      // a card flicked from a phone arrives from below (landing and cancel cues come from FlickLayer)
      if (s.flicks !== prev.flicks && s.flicks.at(-1)?.id !== prev.flicks.at(-1)?.id) director.cue('flick');
      if (s.nudge && s.nudge !== prev.nudge) director.cue('nudge');
      // full: a finger on a phone touching a new space
      if (s.hovers !== prev.hovers) {
        for (const [id, h] of Object.entries(s.hovers)) {
          if (h.spaceId && lastHover[id] !== h.spaceId) director.cue('hover');
        }
        lastHover = Object.fromEntries(Object.entries(s.hovers).map(([id, h]) => [id, h.spaceId]));
      }
    };
    return useNet.subscribe(onState);
  }, []);

  return (
    <>
    {/* until the first tap or key: a chip in the bottom-right corner (the lane keeps clear of it meanwhile) */}
    <div style={{position: 'fixed', right: SOUND_CHIP_INSET, bottom: SOUND_CHIP_INSET, zIndex: 200, pointerEvents: 'none'}}>
      <AnimatePresence>
        {!unlocked && !muted && (
          <motion.div key="chip" initial={{opacity: 0, y: 10}} animate={{opacity: 0.85, y: 0}} exit={{opacity: 0, y: 10}} transition={{duration: 0.5}}
            className="cond"
            style={{padding: '0.5vw 1vw', borderRadius: 999, background: 'rgba(12,5,3,.6)', backdropFilter: 'blur(8px)',
              boxShadow: 'inset 0 0 0 1px var(--rim-strong)', fontSize: tvt(0.95), color: 'var(--ice-dim)'}}>
            Tap or press any key for sound
          </motion.div>
        )}
      </AnimatePresence>
    </div>
    {/* the speaker: in the bottom-left dock, right above the options gear */}
    <button data-sound-toggle="" className="tv-focus" aria-label={muted ? 'Turn sound on' : 'Mute sound'} aria-pressed={muted}
        onClick={(e) => { e.stopPropagation(); director.setMuted(!muted); }}
        style={{position: 'fixed', left: SOUND_LEFT, bottom: SOUND_BOTTOM, zIndex: 210, width: DOCK_BUTTON, height: DOCK_BUTTON, borderRadius: 999, display: 'grid', placeItems: 'center',
          background: 'rgba(12,5,3,.55)', color: 'var(--ice)', opacity: unlocked && !muted ? 0.35 : 0.8, transition: 'opacity .4s'}}>
        <svg viewBox="0 0 24 24" width="60%" height="60%" aria-hidden="true">
          <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" />
          {muted
            ? <path d="m16 9 5 6m0-6-5 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            : <path d="M15.5 8.5a5 5 0 0 1 0 7M18 6a8.5 8.5 0 0 1 0 12" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" />}
        </svg>
      </button>
    </>
  );
}

// ---- Test handle: render any cue offline so levels can be measured without speakers -----------
async function renderOffline(name: Sfx | 'production' | 'ambient' | 'mix', seconds = 4, level = 0.5,
  options?: {master: number; hum: boolean; humVolume: number; effects: number; voice: number}): Promise<number[][]> {
  const rate = 48000;
  const ctx = new OfflineAudioContext(2, Math.ceil(rate * seconds), rate);
  const bus = buildBus(ctx);
  if (options) {
    const l = levelsFor(options, false);
    bus.master.gain.value = l.master; bus.hum.gain.value = l.hum; bus.effects.gain.value = l.effects; bus.voice.gain.value = l.voice;
  }
  if (name === 'mix') {
    // the ambient bed with an effect on top, for checking each option bus on its own
    const {startAmbient} = await import('./synth');
    startAmbient(bus).setProgress(level);
    play(bus, 'city', Math.max(1.5, seconds - 2.5), level);
    const buf = await ctx.startRendering();
    return [Array.from(buf.getChannelData(0)), Array.from(buf.getChannelData(1))];
  }
  if (name === 'production') production(bus, 0.05, 6800, 180);
  else if (name === 'ambient') {
    const {startAmbient} = await import('./synth');
    startAmbient(bus).setProgress(level);
  } else play(bus, name, 0.05, level);
  const buf = await ctx.startRendering();
  return [Array.from(buf.getChannelData(0)), Array.from(buf.getChannelData(1))];
}
(window as unknown as {__sound: unknown}).__sound = {renderOffline, director};
