// Procedural sound for the TV. Everything is synthesised with Web Audio (no samples, nothing to
// license or download). Each sound is a function of (voice, start time) so it renders identically in
// a live AudioContext and in an OfflineAudioContext for level checks.

export type Voice = {
  ctx: BaseAudioContext;
  /** effects bus (dry) */
  fx: AudioNode;
  /** reverb send */
  verb: AudioNode;
  noise: AudioBuffer;
};

export type Bus = Voice & {
  /** the ambient bed's ducking stage (see duck) */
  ambient: GainNode;
  /** the ambient bed's level from the TV options (0 when the hum is off) */
  hum: GainNode;
  /** effects (dry and reverb) level from the TV options */
  effects: GainNode;
  /** mission control's voice level from the TV options */
  voice: GainNode;
  master: GainNode;
  /** the node that reaches the speakers */
  out: AudioNode;
};

/** The master gain at full volume (headroom for the glue compressor and limiter). */
export const MASTER_GAIN = 0.8;

export type Levels = {master: number; hum: number; effects: number; voice: number};

/** Gains for the TV's volume options. Muted silences the master only; each bus keeps its own level. */
export function levelsFor(o: {master: number; hum: boolean; humVolume: number; effects: number; voice: number}, muted: boolean): Levels {
  return {master: muted ? 0 : MASTER_GAIN * o.master, hum: o.hum ? o.humVolume : 0, effects: o.effects, voice: o.voice};
}

/** Move each bus to its level with a short glide (no clicks). */
export function applyLevels(b: Pick<Bus, 'master' | 'hum' | 'effects' | 'voice'> & {ctx: {currentTime: number}}, l: Levels) {
  const now = b.ctx.currentTime;
  for (const [node, v] of [[b.master, l.master], [b.hum, l.hum], [b.effects, l.effects], [b.voice, l.voice]] as const) {
    node.gain.cancelScheduledValues(now);
    node.gain.setTargetAtTime(v, now, 0.06);
  }
}

// ---- graph -----------------------------------------------------------------------------------
export function buildBus(ctx: BaseAudioContext): Bus {
  const master = ctx.createGain();
  master.gain.value = MASTER_GAIN;
  // gentle glue, then a hard ceiling so nothing ever clips
  const glue = ctx.createDynamicsCompressor();
  glue.threshold.value = -20; glue.knee.value = 12; glue.ratio.value = 3; glue.attack.value = 0.01; glue.release.value = 0.25;
  const limit = ctx.createDynamicsCompressor();
  limit.threshold.value = -4; limit.knee.value = 0; limit.ratio.value = 20; limit.attack.value = 0.002; limit.release.value = 0.1;
  master.connect(glue).connect(limit).connect(ctx.destination);

  // Option buses: effects (dry and reverb), the ambient hum and the voice each have their own level.
  const effects = ctx.createGain();
  effects.connect(master);
  const hum = ctx.createGain();
  hum.connect(master);
  const voice = ctx.createGain();
  voice.connect(master);

  const fx = ctx.createGain();
  fx.gain.value = 1;
  fx.connect(effects);

  const convolver = ctx.createConvolver();
  convolver.buffer = impulse(ctx, 3.2, 2.6);
  const verb = ctx.createGain();
  verb.gain.value = 0.9;
  const verbOut = ctx.createGain();
  verbOut.gain.value = 0.55;
  verb.connect(convolver).connect(verbOut).connect(effects);

  const ambient = ctx.createGain();
  ambient.gain.value = 1;
  ambient.connect(hum);

  return {ctx, fx, verb, noise: noiseBuffer(ctx), ambient, hum, effects, voice, master, out: limit};
}

/** A dark, wide hall: stereo decaying noise, low-passed by a one-pole filter as it decays. */
function impulse(ctx: BaseAudioContext, seconds: number, decay: number): AudioBuffer {
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * seconds);
  const buf = ctx.createBuffer(2, len, rate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      const k = 0.18 + 0.75 * t; // darker as the tail goes on
      lp += (Math.random() * 2 - 1 - lp) * (1 - k);
      d[i] = lp * Math.pow(1 - t, decay) * (i < rate * 0.012 ? i / (rate * 0.012) : 1);
    }
  }
  return buf;
}

function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  const len = ctx.sampleRate * 2;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

// ---- building blocks -------------------------------------------------------------------------
type ToneOpts = {
  type?: OscillatorType; freq: number; to?: number; t: number; dur: number; gain: number;
  attack?: number; release?: number; lp?: number; lpTo?: number; q?: number; verb?: number; pan?: number; detune?: number;
};

function tone(v: Voice, o: ToneOpts) {
  const {ctx} = v;
  const osc = ctx.createOscillator();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(o.freq, o.t);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, o.t + o.dur);
  if (o.detune) osc.detune.value = o.detune;
  const g = ctx.createGain();
  const a = o.attack ?? 0.005;
  const r = o.release ?? o.dur * 0.7;
  g.gain.setValueAtTime(0.0001, o.t);
  g.gain.exponentialRampToValueAtTime(o.gain, o.t + a);
  g.gain.setValueAtTime(o.gain, o.t + Math.max(a, o.dur - r));
  g.gain.exponentialRampToValueAtTime(0.0001, o.t + o.dur);
  let node: AudioNode = osc;
  if (o.lp) {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.Q.value = o.q ?? 0.7;
    f.frequency.setValueAtTime(o.lp, o.t);
    if (o.lpTo) f.frequency.exponentialRampToValueAtTime(o.lpTo, o.t + o.dur);
    node.connect(f); node = f;
  }
  node.connect(g);
  route(v, g, o.verb ?? 0.3, o.pan);
  osc.start(o.t); osc.stop(o.t + o.dur + 0.05);
}

type NoiseOpts = {
  t: number; dur: number; gain: number; type?: BiquadFilterType; freq: number; to?: number; q?: number;
  attack?: number; release?: number; verb?: number; pan?: number;
};

function noise(v: Voice, o: NoiseOpts) {
  const {ctx} = v;
  const src = ctx.createBufferSource();
  src.buffer = v.noise;
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = o.type ?? 'bandpass'; f.Q.value = o.q ?? 1;
  f.frequency.setValueAtTime(o.freq, o.t);
  if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, o.t + o.dur);
  const g = ctx.createGain();
  const a = o.attack ?? 0.01;
  const r = o.release ?? o.dur * 0.8;
  g.gain.setValueAtTime(0.0001, o.t);
  g.gain.exponentialRampToValueAtTime(o.gain, o.t + a);
  g.gain.setValueAtTime(o.gain, o.t + Math.max(a, o.dur - r));
  g.gain.exponentialRampToValueAtTime(0.0001, o.t + o.dur);
  src.connect(f).connect(g);
  route(v, g, o.verb ?? 0.3, o.pan);
  src.start(o.t, Math.random() * 1.5); src.stop(o.t + o.dur + 0.05);
}

function route(v: Voice, node: AudioNode, verb: number, pan?: number) {
  let out: AudioNode = node;
  if (pan !== undefined && 'createStereoPanner' in v.ctx) {
    const p = v.ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    node.connect(p); out = p;
  }
  out.connect(v.fx);
  if (verb > 0) {
    const s = v.ctx.createGain();
    s.gain.value = verb;
    out.connect(s).connect(v.verb);
  }
}

/** A soft bell: fundamental plus an inharmonic partial, like a small glass or struck plate. */
function bell(v: Voice, freq: number, t: number, gain: number, dur = 1.6, verb = 0.5, pan?: number) {
  tone(v, {freq, t, dur, gain, attack: 0.004, release: dur * 0.95, verb, pan});
  tone(v, {freq: freq * 2.76, t, dur: dur * 0.45, gain: gain * 0.28, attack: 0.002, release: dur * 0.4, verb, pan});
  tone(v, {freq: freq * 5.4, t, dur: dur * 0.18, gain: gain * 0.08, attack: 0.001, release: dur * 0.17, verb, pan});
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const NOTE = (semitonesFromA4: number) => 440 * Math.pow(2, semitonesFromA4 / 12);
// D major pentatonic and friends, the whole soundtrack sits here so everything harmonises
const D4 = NOTE(-7), E4 = NOTE(-5), FS4 = NOTE(-3), A4 = 440, B4 = NOTE(2), D5 = NOTE(5), E5 = NOTE(7), FS5 = NOTE(9), A5 = NOTE(12), B5 = NOTE(14), D6 = NOTE(17);
const D3 = D4 / 2, A3 = A4 / 2, G3 = NOTE(-14), G4 = G3 * 2;

// ---- the sound map ---------------------------------------------------------------------------
export type Sfx =
  | 'ocean' | 'greenery' | 'city' | 'special'
  | 'temperature' | 'oxygen' | 'oceanParam' | 'maxed'
  | 'cardAutomated' | 'cardActive' | 'cardEvent' | 'cardCorp' | 'cardAction'
  | 'attack' | 'milestone' | 'award' | 'generation' | 'turn' | 'hover' | 'gameEnd' | 'productionLite'
  | 'flick' | 'flickLand' | 'flickCancel' | 'nudge' | 'reaction'
  | 'quindarIn' | 'quindarOut'
  // a player's own chime as their move begins on the TV; `level` is the colour's index in CHIME_COLORS
  | 'chime';

/** Player colours in chime order (each has its own short motif). */
export const CHIME_COLORS = ['red', 'green', 'blue', 'yellow', 'black', 'purple', 'orange', 'pink', 'bronze', 'neutral'] as const;

/**
 * Each colour's motif: two or three soft bells from the soundtrack's D major pentatonic, so any two players' chimes
 * sound distinct but never clash with the bed or each other. [frequency, delay s, gain] per note.
 */
const CHIMES: Array<Array<[number, number, number]>> = [
  [[D5, 0, 0.06], [A5, 0.11, 0.05]], // red: a rising fifth
  [[FS5, 0, 0.055], [A5, 0.09, 0.05], [D6, 0.18, 0.035]], // green: a little climb
  [[A5, 0, 0.055], [E5, 0.12, 0.05]], // blue: a falling fourth
  [[E5, 0, 0.055], [B5, 0.08, 0.045]], // yellow: a quick bright fifth
  [[D4, 0, 0.07], [A4, 0, 0.04], [D5, 0.14, 0.045]], // black: a low open dyad, then its octave
  [[B4, 0, 0.055], [FS5, 0.12, 0.05]], // purple: a rising fifth from B
  [[A4, 0, 0.05], [D5, 0.08, 0.05], [E5, 0.16, 0.04]], // orange: three steps up
  [[D6, 0, 0.04], [B5, 0.1, 0.045]], // pink: a high falling third
  [[G4, 0, 0.06], [D5, 0.12, 0.045]], // bronze: a warm low fifth
  [[A4, 0, 0.05], [A5, 0.12, 0.035]], // neutral: an octave
];

/** Plays a sound at time t. `level` is 0..1 progress for pitch-rising cues. Returns its length. */
export function play(v: Voice, name: Sfx, t: number, level = 0): number {
  switch (name) {
  case 'chime': {
    // soft and short: the bed is not ducked for it, and it sits under the card cue that follows
    const notes = CHIMES[Math.max(0, Math.min(CHIMES.length - 1, Math.round(level)))];
    notes.forEach(([f, d, g], i) => bell(v, f, t + d, g, 1.1, 0.5, (i - (notes.length - 1) / 2) * 0.25));
    return 1.3;
  }
  case 'quindarIn': case 'quindarOut': {
    // Apollo-style Quindar tones that open and close a mission control transmission (2525 / 2475 Hz,
    // 250 ms). Kept quiet and dry so they read as a radio cue rather than a beep.
    tone(v, {freq: name === 'quindarIn' ? 2525 : 2475, t, dur: 0.25, gain: 0.03, attack: 0.012, release: 0.03, verb: 0.05});
    return 0.25;
  }
  case 'ocean': {
    // a wash of water rolling in, then a few rising bubbles
    noise(v, {t, dur: 1.7, gain: 0.22, type: 'lowpass', freq: 280, to: 1500, q: 0.8, attack: 0.25, release: 1.2, verb: 0.6});
    noise(v, {t: t + 0.05, dur: 1.2, gain: 0.08, type: 'bandpass', freq: 2200, to: 900, q: 0.6, attack: 0.3, verb: 0.5, pan: -0.3});
    for (let i = 0; i < 6; i++) {
      const s = t + 0.25 + i * rand(0.08, 0.16);
      const f = rand(420, 900);
      tone(v, {freq: f, to: f * 1.9, t: s, dur: 0.09, gain: 0.05, attack: 0.004, release: 0.08, verb: 0.5, pan: rand(-0.6, 0.6)});
    }
    return 1.8;
  }
  case 'greenery': {
    // rustle, then a soft bloom arpeggio
    for (let i = 0; i < 7; i++) noise(v, {t: t + i * 0.045, dur: 0.18, gain: 0.05, type: 'bandpass', freq: rand(3200, 6000), q: 2, attack: 0.01, release: 0.16, verb: 0.2, pan: rand(-0.5, 0.5)});
    [D5, FS5, A5, D6].forEach((f, i) => tone(v, {freq: f, t: t + 0.18 + i * 0.09, dur: 1.2, gain: 0.07 - i * 0.01, attack: 0.03, release: 1.1, verb: 0.55, pan: -0.3 + i * 0.2}));
    return 1.6;
  }
  case 'city': {
    // a hum rising out of the ground, then a bright arrival
    tone(v, {type: 'sawtooth', freq: 55, to: 110, t, dur: 1.2, gain: 0.08, attack: 0.5, release: 0.4, lp: 180, lpTo: 1400, verb: 0.3});
    tone(v, {type: 'sawtooth', freq: 82.5, to: 165, t, dur: 1.2, gain: 0.05, attack: 0.5, release: 0.4, lp: 160, lpTo: 1200, verb: 0.3, detune: 6});
    bell(v, A5, t + 1.05, 0.08, 1.4, 0.5, 0.2);
    bell(v, D6, t + 1.12, 0.05, 1.3, 0.5, -0.2);
    return 2.5;
  }
  case 'special': {
    // a heavy stamp with a metallic ring
    tone(v, {freq: 95, to: 42, t, dur: 0.35, gain: 0.2, attack: 0.002, release: 0.33, verb: 0.2});
    noise(v, {t, dur: 0.08, gain: 0.14, type: 'lowpass', freq: 2500, attack: 0.001, release: 0.07, verb: 0.2});
    tone(v, {freq: 523, t: t + 0.01, dur: 0.9, gain: 0.04, attack: 0.002, release: 0.85, verb: 0.6, pan: 0.2});
    tone(v, {freq: 1371, t: t + 0.01, dur: 0.6, gain: 0.02, attack: 0.002, release: 0.55, verb: 0.6, pan: -0.2});
    return 1.2;
  }
  case 'temperature': {
    // warmth rising: a filtered saw glide with a crackle, pitch climbs as Mars heats
    const base = 196 * Math.pow(2, level * 1.0);
    tone(v, {type: 'sawtooth', freq: base, to: base * 1.5, t, dur: 0.9, gain: 0.06, attack: 0.08, release: 0.5, lp: 600, lpTo: 2400, verb: 0.4});
    for (let i = 0; i < 5; i++) noise(v, {t: t + rand(0, 0.6), dur: 0.05, gain: 0.05, type: 'highpass', freq: 3000, attack: 0.002, release: 0.04, verb: 0.1, pan: rand(-0.6, 0.6)});
    return 1.2;
  }
  case 'oxygen': {
    // a breath of air and a rising pure tone
    const base = 330 * Math.pow(2, level * 1.0);
    noise(v, {t, dur: 1.0, gain: 0.08, type: 'bandpass', freq: 900, to: 2600, q: 0.7, attack: 0.3, release: 0.6, verb: 0.5});
    tone(v, {freq: base, to: base * 1.5, t: t + 0.1, dur: 0.9, gain: 0.06, attack: 0.15, release: 0.6, verb: 0.6});
    return 1.3;
  }
  case 'oceanParam': {
    const base = 262 * Math.pow(2, level * 1.0);
    tone(v, {freq: base, to: base * 1.335, t, dur: 0.8, gain: 0.06, attack: 0.05, release: 0.6, verb: 0.6});
    noise(v, {t, dur: 0.8, gain: 0.07, type: 'lowpass', freq: 400, to: 1200, attack: 0.1, verb: 0.5});
    return 1.0;
  }
  case 'maxed': {
    // a parameter completed: a wide swelling chord with a shimmer on top
    [D3, A3, D4, FS4, A4].forEach((f, i) => tone(v, {type: i < 2 ? 'triangle' : 'sine', freq: f, t, dur: 3.2, gain: 0.05, attack: 1.0, release: 1.8, verb: 0.7, pan: -0.5 + i * 0.25, detune: rand(-5, 5)}));
    for (let i = 0; i < 10; i++) tone(v, {freq: [D6, A5, FS5, E5][i % 4] * 2, t: t + 0.8 + i * 0.12, dur: 0.5, gain: 0.02, attack: 0.003, release: 0.45, verb: 0.8, pan: rand(-0.8, 0.8)});
    return 3.6;
  }
  case 'cardAutomated':
  case 'cardActive':
  case 'cardEvent':
  case 'cardCorp': {
    // the card slides onto the table, then a chime in its type's voice
    noise(v, {t, dur: 0.32, gain: 0.08, type: 'bandpass', freq: 700, to: 3200, q: 0.9, attack: 0.05, release: 0.2, verb: 0.2, pan: -0.2});
    const s = t + 0.22;
    if (name === 'cardAutomated') { bell(v, E5, s, 0.08, 1.1, 0.45, -0.15); bell(v, B5, s + 0.1, 0.06, 1.1, 0.45, 0.15); }
    if (name === 'cardActive') { bell(v, D5, s, 0.07, 1.6, 0.55); bell(v, A5, s + 0.06, 0.04, 1.5, 0.55, 0.2); }
    if (name === 'cardEvent') {
      tone(v, {type: 'triangle', freq: A5, t: s, dur: 0.25, gain: 0.1, attack: 0.003, release: 0.22, verb: 0.4});
      tone(v, {type: 'triangle', freq: E5, t: s + 0.12, dur: 0.4, gain: 0.1, attack: 0.003, release: 0.37, verb: 0.45});
    }
    if (name === 'cardCorp') [D4, FS4, A4, D5].forEach((f, i) => bell(v, f, s + i * 0.07, 0.05, 2.2, 0.6, -0.3 + i * 0.2));
    return 1.8;
  }
  case 'cardAction': {
    // a card's action: a short mechanical clunk (a latch thrown), then a tone rising out of it
    noise(v, {t, dur: 0.07, gain: 0.1, type: 'bandpass', freq: 2400, q: 2.2, attack: 0.001, release: 0.06, verb: 0.1, pan: 0.1});
    tone(v, {type: 'triangle', freq: 150, to: 62, t: t + 0.01, dur: 0.16, gain: 0.13, attack: 0.002, release: 0.14, verb: 0.15});
    noise(v, {t: t + 0.01, dur: 0.14, gain: 0.08, type: 'lowpass', freq: 520, to: 160, attack: 0.002, release: 0.12, verb: 0.15});
    noise(v, {t: t + 0.09, dur: 0.05, gain: 0.06, type: 'bandpass', freq: 1500, q: 2.5, attack: 0.001, release: 0.045, verb: 0.15, pan: -0.15});
    tone(v, {type: 'square', freq: D4, to: A5, t: t + 0.12, dur: 0.34, gain: 0.022, attack: 0.02, release: 0.16, lp: 1400, lpTo: 4200, verb: 0.45});
    tone(v, {freq: D5, to: D6, t: t + 0.14, dur: 0.32, gain: 0.05, attack: 0.02, release: 0.14, verb: 0.5, pan: 0.2});
    return 0.8;
  }
  case 'attack': {
    // impact, a dissonant sting, and a rumble that dies away
    tone(v, {freq: 80, to: 33, t, dur: 0.6, gain: 0.22, attack: 0.002, release: 0.55, verb: 0.3});
    noise(v, {t, dur: 0.25, gain: 0.16, type: 'lowpass', freq: 900, to: 200, attack: 0.002, release: 0.22, verb: 0.3});
    noise(v, {t: t + 0.05, dur: 1.8, gain: 0.09, type: 'lowpass', freq: 160, q: 0.8, attack: 0.1, release: 1.5, verb: 0.4});
    tone(v, {type: 'sawtooth', freq: NOTE(8), t: t + 0.03, dur: 0.7, gain: 0.018, attack: 0.01, release: 0.6, lp: 1500, verb: 0.5, pan: 0.3});
    tone(v, {type: 'sawtooth', freq: NOTE(9), t: t + 0.03, dur: 0.7, gain: 0.018, attack: 0.01, release: 0.6, lp: 1500, verb: 0.5, pan: -0.3});
    return 2.0;
  }
  case 'milestone':
  case 'award': {
    // a small fanfare; milestones climb higher than awards
    const notes = name === 'milestone' ? [D5, FS5, A5, D6] : [A4, D5, FS5, A5];
    notes.forEach((f, i) => tone(v, {type: 'sawtooth', freq: f, t: t + i * 0.13, dur: i === 3 ? 1.4 : 0.32, gain: 0.075, attack: 0.02, release: i === 3 ? 1.2 : 0.25, lp: 900, lpTo: 3200, verb: 0.55, pan: -0.3 + i * 0.2, detune: 4}));
    bell(v, notes[3] * 2, t + 0.39, 0.06, 1.6, 0.7);
    return 2.0;
  }
  case 'generation': {
    // a soft gong
    [D3, D3 * 2.01, D3 * 2.99, D3 * 4.2].forEach((f, i) => tone(v, {freq: f, t, dur: 3 - i * 0.5, gain: 0.08 / (i + 1), attack: 0.01, release: 2.8 - i * 0.5, verb: 0.7}));
    noise(v, {t, dur: 1.5, gain: 0.03, type: 'bandpass', freq: 5000, q: 0.5, attack: 0.3, verb: 0.8});
    return 3.2;
  }
  case 'turn':
    // a discreet tick-tock
    tone(v, {type: 'triangle', freq: 1760, t, dur: 0.05, gain: 0.03, attack: 0.001, release: 0.045, verb: 0.2});
    tone(v, {type: 'triangle', freq: 1320, t: t + 0.09, dur: 0.06, gain: 0.025, attack: 0.001, release: 0.055, verb: 0.25});
    return 0.4;
  case 'hover':
    tone(v, {freq: 2637, t, dur: 0.07, gain: 0.012, attack: 0.002, release: 0.06, verb: 0.4});
    return 0.2;
  case 'gameEnd': {
    // D – G – A – D pads with sparkles, the whole table exhales
    const chords = [[D3, A3, D4, FS4], [G3, D4, G4, B4], [A3, E4, A4, NOTE(4)], [D3, A3, FS4, D5]];
    chords.forEach((ch, k) => ch.forEach((f, i) => tone(v, {type: i === 0 ? 'triangle' : 'sine', freq: f, t: t + k * 1.1, dur: k === 3 ? 4 : 1.5, gain: 0.05, attack: 0.3, release: k === 3 ? 3 : 0.8, verb: 0.7, pan: -0.4 + i * 0.27})));
    for (let i = 0; i < 24; i++) tone(v, {freq: [D6, A5, FS5, B5, E5][i % 5] * (i % 3 === 0 ? 2 : 1), t: t + 1 + i * 0.13, dur: 0.6, gain: 0.018, attack: 0.003, release: 0.55, verb: 0.8, pan: rand(-0.9, 0.9)});
    return 7.5;
  }
  case 'productionLite':
    return production(v, t, 3200, 40);
  case 'flick': {
    // a card thrown up from below: an airy whoosh that rises and passes, a flutter of paper at the top
    noise(v, {t, dur: 0.75, gain: 0.12, type: 'bandpass', freq: 380, to: 3400, q: 0.8, attack: 0.25, release: 0.4, verb: 0.25, pan: 0.25});
    noise(v, {t: t + 0.08, dur: 0.6, gain: 0.05, type: 'highpass', freq: 5200, attack: 0.2, release: 0.35, verb: 0.2, pan: -0.2});
    for (let i = 0; i < 4; i++) noise(v, {t: t + 0.5 + i * 0.035, dur: 0.05, gain: 0.03, type: 'bandpass', freq: rand(2500, 4200), q: 3, attack: 0.003, release: 0.045, verb: 0.2});
    return 0.9;
  }
  case 'flickLand': {
    // the card settles into its player's place: a soft tap and a two-note glint
    tone(v, {freq: 180, to: 110, t, dur: 0.12, gain: 0.07, attack: 0.002, release: 0.11, verb: 0.2});
    bell(v, FS5, t + 0.04, 0.05, 0.9, 0.45, 0.25);
    bell(v, D6, t + 0.12, 0.035, 0.9, 0.45, 0.35);
    return 1.0;
  }
  case 'flickCancel': {
    // not played: a gentle falling breath, never a buzzer
    noise(v, {t, dur: 0.7, gain: 0.07, type: 'bandpass', freq: 2200, to: 300, q: 0.8, attack: 0.05, release: 0.55, verb: 0.35});
    tone(v, {type: 'triangle', freq: B4, to: FS4, t: t + 0.05, dur: 0.5, gain: 0.04, attack: 0.02, release: 0.45, verb: 0.5});
    return 0.8;
  }
  case 'reaction': {
    // A sticker from a phone: eight small, quiet signatures (level picks the sticker, see STICKERS).
    // Short enough to sit under the table's talk; a combined burst plays one of these once.
    const k = Math.max(0, Math.min(7, Math.round(level * 7)));
    switch (k) {
    case 0: // ouch: a soft thump and a falling "ow"
      tone(v, {freq: 200, to: 90, t, dur: 0.14, gain: 0.06, attack: 0.002, release: 0.12, verb: 0.2});
      tone(v, {type: 'triangle', freq: A4, to: E4, t: t + 0.05, dur: 0.3, gain: 0.035, attack: 0.01, release: 0.26, verb: 0.35});
      return 0.4;
    case 1: // nice: two rising bells
      bell(v, D5, t, 0.035, 0.9, 0.4, -0.2); bell(v, A5, t + 0.09, 0.03, 0.9, 0.45, 0.2);
      return 0.9;
    case 2: // meteor: a short falling whoosh and a tiny impact
      noise(v, {t, dur: 0.35, gain: 0.05, type: 'bandpass', freq: 3200, to: 500, q: 0.9, attack: 0.03, release: 0.3, verb: 0.3, pan: 0.3});
      tone(v, {freq: 140, to: 70, t: t + 0.3, dur: 0.12, gain: 0.05, attack: 0.002, release: 0.11, verb: 0.3});
      return 0.5;
    case 3: // greenery: a leafy rustle and a single soft bell
      noise(v, {t, dur: 0.25, gain: 0.03, type: 'highpass', freq: 4200, attack: 0.05, release: 0.2, verb: 0.3});
      bell(v, FS5, t + 0.08, 0.03, 1, 0.5);
      return 1.0;
    case 4: // money: a coin ping
      bell(v, B5, t, 0.03, 0.6, 0.35, 0.1); bell(v, E5 * 2, t + 0.06, 0.02, 0.5, 0.35, -0.1);
      return 0.7;
    case 5: // laugh: three bouncy blips
      [0, 0.09, 0.18].forEach((d, i) => tone(v, {type: 'triangle', freq: [A4, B4, D5][i], to: [A4, B4, D5][i] * 1.06, t: t + d, dur: 0.07, gain: 0.035, attack: 0.004, release: 0.06, verb: 0.25}));
      return 0.35;
    case 6: // wow: a rising "ooh"
      tone(v, {type: 'sine', freq: D4, to: A4, t, dur: 0.45, gain: 0.04, attack: 0.08, release: 0.3, verb: 0.45, lp: 1400});
      return 0.55;
    default: // gg: a two-note fanfare
      bell(v, D5, t, 0.03, 1, 0.5, -0.25); bell(v, A5, t + 0.14, 0.03, 1.2, 0.55, 0.25); bell(v, D6, t + 0.14, 0.015, 1.2, 0.55);
      return 1.3;
    }
  }
  case 'nudge': {
    // a friendly double knock and a little rising "hm?"
    [0, 0.16].forEach((d) => {
      tone(v, {freq: 240, to: 150, t: t + d, dur: 0.1, gain: 0.08, attack: 0.002, release: 0.09, verb: 0.3});
      noise(v, {t: t + d, dur: 0.05, gain: 0.04, type: 'bandpass', freq: 1200, q: 1.2, attack: 0.001, release: 0.045, verb: 0.3});
    });
    tone(v, {type: 'triangle', freq: A4, to: D5, t: t + 0.42, dur: 0.35, gain: 0.05, attack: 0.03, release: 0.3, verb: 0.5});
    return 0.9;
  }
  }
}

/**
 * The production showpiece, timed to the TV animation (Production.tsx):
 * 0–0.3 s build · 0.3 burst · 0.45–1.9 fountain (token sparkles) · 1.95–2.9 fly-out ·
 * 2.9 celebration · tail to the end.
 */
export function production(v: Voice, t: number, durationMs: number, tokens: number): number {
  const k = durationMs / 6800; // stretch everything if the server changes the show length
  const at = (s: number) => t + s * k;
  // build: rising filtered noise and a climbing tone
  noise(v, {t, dur: 0.36 * k, gain: 0.1, type: 'bandpass', freq: 400, to: 4000, q: 1.2, attack: 0.3 * k, release: 0.05, verb: 0.3});
  tone(v, {type: 'sawtooth', freq: 110, to: 440, t, dur: 0.34 * k, gain: 0.05, attack: 0.25 * k, release: 0.05, lp: 400, lpTo: 3000, verb: 0.3});
  // burst
  tone(v, {freq: 70, to: 38, t: at(0.3), dur: 0.7, gain: 0.18, attack: 0.002, release: 0.65, verb: 0.3});
  noise(v, {t: at(0.3), dur: 0.5, gain: 0.14, type: 'lowpass', freq: 3000, to: 400, attack: 0.002, release: 0.45, verb: 0.5});
  [D4, A4, D5, FS5].forEach((f, i) => bell(v, f, at(0.31) + i * 0.02, 0.06, 2.2, 0.6, -0.4 + i * 0.27));
  // fountain: coin sparkles, count follows the tokens, climbing through the pentatonic
  const n = Math.max(10, Math.min(46, Math.round(tokens * 0.3)));
  const scale = [D5, E5, FS5, A5, B5, D6, D6 * 1.122, D6 * 1.26, D6 * 1.5];
  for (let i = 0; i < n; i++) {
    const s = at(0.45 + (i / n) * 1.4) + rand(-0.02, 0.02);
    const f = scale[Math.min(scale.length - 1, Math.floor((i / n) * scale.length + rand(0, 2)))];
    tone(v, {type: 'triangle', freq: f, t: s, dur: 0.14, gain: 0.03, attack: 0.002, release: 0.13, verb: 0.45, pan: rand(-0.8, 0.8)});
    tone(v, {freq: f * 2.02, t: s, dur: 0.08, gain: 0.012, attack: 0.001, release: 0.07, verb: 0.45});
  }
  // fly-out: a wide whoosh sweeping past, with the sparkles streaking away
  noise(v, {t: at(1.9), dur: 1.0 * k, gain: 0.13, type: 'bandpass', freq: 600, to: 5000, q: 0.8, attack: 0.35 * k, release: 0.5 * k, verb: 0.35, pan: 0.2});
  for (let i = 0; i < 14; i++) tone(v, {freq: rand(2000, 3600), to: rand(900, 1400), t: at(1.95 + i * 0.065), dur: 0.2, gain: 0.014, attack: 0.002, release: 0.18, verb: 0.5, pan: 0.2 + i * 0.05});
  // celebration: chord bloom and confetti crackle
  [D4, FS4, A4, D5, A5].forEach((f, i) => tone(v, {type: i === 0 ? 'triangle' : 'sine', freq: f, t: at(2.9), dur: 3.0 * k, gain: 0.045, attack: 0.08, release: 2.6 * k, verb: 0.7, pan: -0.5 + i * 0.25}));
  for (let i = 0; i < 22; i++) noise(v, {t: at(2.95) + rand(0, 1.8 * k), dur: 0.035, gain: 0.03, type: 'highpass', freq: rand(4000, 7000), attack: 0.001, release: 0.03, verb: 0.3, pan: rand(-0.9, 0.9)});
  return (durationMs / 1000) + 0.5;
}

// ---- ambient ---------------------------------------------------------------------------------
export type Ambient = {setProgress: (p: number) => void; stop: () => void};

/**
 * A slow wind and drone bed. Progress 0..1 is how terraformed Mars is: the filter opens,
 * a warm third and a high airy pad fade in, the wind softens.
 */
export function startAmbient(b: Bus): Ambient {
  const {ctx} = b;
  const t = ctx.currentTime;
  const out = ctx.createGain();
  out.gain.setValueAtTime(0.0001, t);
  out.gain.exponentialRampToValueAtTime(1, t + 6);
  out.connect(b.ambient);

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 320; lp.Q.value = 0.9;
  lp.connect(out);
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.045;
  const lfoAmt = ctx.createGain();
  lfoAmt.gain.value = 120;
  lfo.connect(lfoAmt).connect(lp.frequency);

  const drones: Array<{osc: OscillatorNode; g: GainNode}> = [];
  const drone = (f: number, type: OscillatorType, gain: number, detune = 0) => {
    const osc = ctx.createOscillator();
    osc.type = type; osc.frequency.value = f; osc.detune.value = detune;
    const g = ctx.createGain();
    g.gain.value = gain;
    osc.connect(g).connect(lp);
    osc.start(t);
    drones.push({osc, g});
    return g;
  };
  drone(D3 / 2, 'sawtooth', 0.012, -4);
  drone(D3 / 2, 'sawtooth', 0.012, 5);
  drone(A3 / 2, 'triangle', 0.02);
  const third = drone(FS4 / 2, 'sine', 0.0001);
  // a high pad that only exists on a living Mars
  const pad = ctx.createGain();
  pad.gain.value = 0.0001;
  pad.connect(out);
  for (const [f, d] of [[D5, -6], [A5, 7], [FS5, 0]] as Array<[number, number]>) {
    const osc = ctx.createOscillator();
    osc.frequency.value = f; osc.detune.value = d;
    const g = ctx.createGain();
    g.gain.value = 0.006;
    osc.connect(g).connect(pad);
    osc.start(t);
    drones.push({osc, g});
  }

  // wind: looped noise through a wandering band-pass
  const wind = ctx.createBufferSource();
  wind.buffer = b.noise; wind.loop = true;
  const wbp = ctx.createBiquadFilter();
  wbp.type = 'bandpass'; wbp.frequency.value = 450; wbp.Q.value = 0.9;
  const wg = ctx.createGain();
  wg.gain.value = 0.03;
  const wlfo = ctx.createOscillator();
  wlfo.frequency.value = 0.07;
  const wlfoAmt = ctx.createGain();
  wlfoAmt.gain.value = 260;
  wlfo.connect(wlfoAmt).connect(wbp.frequency);
  const gust = ctx.createOscillator();
  gust.frequency.value = 0.11;
  const gustAmt = ctx.createGain();
  gustAmt.gain.value = 0.008;
  gust.connect(gustAmt).connect(wg.gain);
  const wlp = ctx.createBiquadFilter();
  wlp.type = 'lowpass'; wlp.frequency.value = 1400; wlp.Q.value = 0.5;
  wind.connect(wbp).connect(wlp).connect(wg).connect(out);
  wind.start(t); lfo.start(t); wlfo.start(t); gust.start(t);

  let current = -1;
  return {
    setProgress(p: number) {
      const q = Math.max(0, Math.min(1, p));
      if (Math.abs(q - current) < 0.01) return;
      current = q;
      const now = ctx.currentTime;
      lp.frequency.setTargetAtTime(320 + q * 1100, now, 4);
      third.gain.setTargetAtTime(0.0001 + q * 0.014, now, 4);
      pad.gain.setTargetAtTime(0.0001 + q * q * 1, now, 5);
      wg.gain.setTargetAtTime(0.03 - q * 0.013, now, 5);
      wbp.frequency.setTargetAtTime(450 + q * 600, now, 5);
      wlp.frequency.setTargetAtTime(1400 + q * 1200, now, 5);
    },
    stop() {
      const now = ctx.currentTime;
      out.gain.setTargetAtTime(0.0001, now, 0.4);
      const end = now + 2;
      for (const d of drones) d.osc.stop(end);
      wind.stop(end); lfo.stop(end); wlfo.stop(end); gust.stop(end);
    },
  };
}

/** Pull the ambient bed down under a big moment and let it come back slowly. */
export function duck(b: Bus, depth = 0.3, holdS = 1.2) {
  const now = b.ctx.currentTime;
  const g = b.ambient.gain;
  g.cancelScheduledValues(now);
  g.setValueAtTime(g.value, now);
  g.linearRampToValueAtTime(depth, now + 0.15);
  g.setValueAtTime(depth, now + 0.15 + holdS);
  g.linearRampToValueAtTime(1, now + 0.15 + holdS + 1.6);
}
