// Owns the AudioContext: unlock, mute, the ambient bed, ducking and rate limiting.
// Game code asks for cues by name; the director decides whether and when they sound.
import {applyLevels, buildBus, duck, levelsFor, play, production, startAmbient} from './synth';
import {getSettings, subscribeSettings} from '../settings';
import type {Ambient, Bus, Sfx} from './synth';
import {CHIME_COLORS} from './synth';
import {DUCK_DEPTH, radioMix} from '../radio/mix';

const MUTE_KEY = 'mars-ledger-tv-muted';

/** Minimum gap between two plays of the same cue, in seconds. */
const MIN_GAP: Partial<Record<Sfx, number>> = {
  turn: 0.6, hover: 0.15, ocean: 0.25, greenery: 0.25, city: 0.3, special: 0.3,
  temperature: 0.3, oxygen: 0.3, oceanParam: 0.3, maxed: 2, attack: 0.8, generation: 2, gameEnd: 10,
  cardAutomated: 0.3, cardActive: 0.3, cardEvent: 0.3, cardCorp: 0.25, cardAction: 0.4, milestone: 0.8, award: 0.8,
  flick: 0.3, flickLand: 0.3, chime: 0.25, flickCancel: 0.5, nudge: 1.5, reaction: 0.25, quindarIn: 0.2, quindarOut: 0.2,
};
/** Cues big enough to pull the ambient bed down. */
const DUCKS: Partial<Record<Sfx, number>> = {maxed: 2.5, attack: 1.2, gameEnd: 6, milestone: 1.2, award: 1.2, generation: 1.5};

type Listener = () => void;

export class SoundDirector {
  private ctx: AudioContext | null = null;
  private bus: Bus | null = null;
  private ambient: Ambient | null = null;
  private last = new Map<Sfx, number>();
  /** next free slot, so a burst of cues in one update is spaced out instead of piled up */
  private cursor = 0;
  private recent: number[] = [];
  private progress = 0;
  private shows = new Set<string>();
  private listeners = new Set<Listener>();
  muted = readMuted();

  constructor() {
    // The TV options (volumes, hum) apply live.
    subscribeSettings(() => this.applyLevels());
    radioMix.subscribe(() => this.applyLevels());
  }

  /** Set each bus to the TV options' level (master follows mute). */
  private applyLevels() {
    if (this.bus) applyLevels(this.bus, levelsFor(radioMix.gate(getSettings()), this.muted));
  }

  get unlocked() { return this.ctx?.state === 'running'; }

  subscribe(l: Listener) { this.listeners.add(l); return () => { this.listeners.delete(l); }; }
  private emit() { for (const l of this.listeners) l(); }

  /** Call from a user gesture. Creates or resumes the context. */
  unlock() {
    if (this.muted) return;
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as {webkitAudioContext: typeof AudioContext}).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor({latencyHint: 'playback'});
      this.bus = buildBus(this.ctx);
      applyLevels(this.bus, levelsFor(radioMix.gate(getSettings()), this.muted));
      this.ctx.onstatechange = () => this.emit();
    }
    void this.ctx.resume().then(() => {
      if (this.bus && !this.ambient) {
        this.ambient = startAmbient(this.bus);
        this.ambient.setProgress(this.progress);
      }
      this.emit();
    });
  }

  setMuted(m: boolean) {
    this.muted = m;
    try { localStorage.setItem(MUTE_KEY, m ? '1' : '0'); } catch { /* private mode */ }
    if (this.ctx && this.bus) {
      this.applyLevels();
      if (m) void this.ctx.suspend();
      else void this.ctx.resume();
    } else if (!m) this.unlock();
    this.emit();
  }

  setProgress(p: number) {
    this.progress = p;
    this.ambient?.setProgress(p);
  }

  /** Play a cue now (or in the next free slot). `level` is 0..1 for pitch-rising cues. */
  cue(name: Sfx, level = 0) {
    if (!this.ctx || !this.bus || this.muted || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    const gap = MIN_GAP[name] ?? 0.2;
    if (now - (this.last.get(name) ?? -99) < gap) return;
    // never more than 6 cues in any 1.5 s window: extra ones are dropped, not queued
    this.recent = this.recent.filter((x) => now - x < 1.5);
    if (this.recent.length >= 6) return;
    this.recent.push(now);
    this.last.set(name, now);
    const at = Math.max(now + 0.02, this.cursor);
    this.cursor = at + 0.14;
    const d = DUCKS[name];
    if (d) { duck(this.bus, 0.3, d); radioMix.duck('cue', DUCK_DEPTH.cue, d * 1000); }
    play(this.bus, name, at, level);
  }

  /** A player's own chime (Phase 1 of their move on the TV). */
  chime(color: string) {
    const i = (CHIME_COLORS as readonly string[]).indexOf(color);
    this.cue('chime', i < 0 ? CHIME_COLORS.length - 1 : i);
  }

  /** Can the TV speak right now? (sound unlocked and not muted) */
  get canSpeak(): boolean {
    return !!this.ctx && !!this.bus && !this.muted && this.ctx.state === 'running';
  }

  /**
   * Speak a mission control line: Quindar tone in, the voice, Quindar tone out, with the ambient bed
   * ducked for the whole transmission. Resolves with the transmission's length in ms once it has
   * started, or null when the TV cannot speak (locked, muted, fetch or decode failed).
   */
  async speak(url: string): Promise<number | null> {
    if (!this.canSpeak) return null;
    let buffer: AudioBuffer;
    try {
      const r = await fetch(url);
      if (!r.ok) return null;
      buffer = await this.ctx!.decodeAudioData(await r.arrayBuffer());
    } catch {
      return null;
    }
    if (!this.canSpeak) return null;
    const ctx = this.ctx!; const bus = this.bus!;
    const t = ctx.currentTime + 0.05;
    play(bus, 'quindarIn', t);
    const voiceAt = t + 0.4;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const g = ctx.createGain();
    g.gain.value = 0.9;
    src.connect(g).connect(bus.voice);
    src.start(voiceAt);
    const end = voiceAt + buffer.duration;
    play(bus, 'quindarOut', end + 0.2);
    duck(bus, 0.25, end - ctx.currentTime + 0.4);
    return Math.round((end + 0.45 - t) * 1000);
  }

  /** The production show, aligned to the show's start on this device's clock. */
  production(id: string, localStartMs: number, durationMs: number, tokens: number) {
    if (this.shows.has(id)) return;
    this.shows.add(id);
    if (!this.ctx || !this.bus || this.muted || this.ctx.state !== 'running') return;
    const lead = (localStartMs - Date.now()) / 1000;
    const late = -lead;
    if (late > 0.5) return; // joined mid-show: stay quiet rather than start out of sync
    const at = this.ctx.currentTime + Math.max(0.02, lead);
    duck(this.bus, 0.2, Math.max(0, lead) + durationMs / 1000);
    production(this.bus, at, durationMs, tokens);
  }
}

function readMuted(): boolean {
  try { return localStorage.getItem(MUTE_KEY) === '1'; } catch { return false; }
}

export const director = new SoundDirector();
