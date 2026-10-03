// The outside services mission control uses: an OpenAI-compatible LLM (writes the line) and speech (speaks it).
// Speech tries the paid voices in NARRATOR_TTS_PROVIDER's order (Gemini through OpenRouter, Hume Octave), then an
// OpenAI-compatible /audio/speech server (NARRATOR_TTS_URL) as the per-line fallback, or that server alone. Nothing
// has a default endpoint: without an LLM the feature is off, without a speech provider only text is offered. Every
// call has a hard timeout; failures are reported, never thrown at the game.
// Hume ends its TTS API on 13 Nov 2026, so Hume is not in the default order.
import type {ChatMessage} from './prompt';

/** A paid voice, tried before the local server. */
export type PaidTts = 'gemini' | 'hume';
/** Who spoke a line: a paid voice or the OpenAI-compatible server. */
export type TtsProvider = PaidTts | 'openai';

export const TTS_NAMES: Record<TtsProvider, string> = {gemini: 'Gemini', hume: 'Hume', openai: 'the local voice'};
/** Who holds the account (and its credits) for each paid voice. */
export const TTS_ACCOUNT: Record<PaidTts, string> = {gemini: 'OpenRouter', hume: 'Hume'};

export type NarratorConfig = {
  llmUrl: string;
  /** optional bearer token for the LLM (NARRATOR_LLM_API_KEY) */
  llmKey?: string;
  llmModel: string;
  llmTimeoutMs: number;
  /** the openai-compatible server: the whole voice when no paid voice is set, the fallback otherwise */
  ttsUrl: string;
  /** optional bearer token for the speech server (NARRATOR_TTS_API_KEY) */
  ttsKey?: string;
  ttsModel: string;
  ttsVoice: string;
  ttsTimeoutMs: number;
  /** paid voices to try, in order, before the openai-compatible server (NARRATOR_TTS_PROVIDER) */
  ttsOrder: PaidTts[];
  gemini: GeminiConfig;
  hume: HumeConfig;
  /** spend on paid speech per game; once reached, the rest of the game uses the fallback */
  budgetUsd: number;
};

export type GeminiConfig = {
  /** OpenRouter's API base */
  url: string;
  key: string;
  model: string;
  voice: string;
  /** the narrator's standing character, sent as the style direction ahead of each line's acting note */
  character: string;
  /** turn pauses, sighs and laughs into Gemini's inline tags */
  tags: boolean;
  timeoutMs: number;
  /** price of generated audio per minute (Gemini bills audio tokens, about 32 per second) */
  usdPerAudioMin: number;
};

export type HumeConfig = {
  url: string;
  key: string;
  voiceId: string;
  /** Octave model version: '2' (faster; refuses acting notes) or '1' (honours acting notes) */
  version: '1' | '2';
  /** send each line's acting note as Hume's per-utterance description */
  acting: boolean;
  timeoutMs: number;
  usdPer1kChars: number;
};

/** The OpenAI-compatible speech voice when NARRATOR_VOICE is not set (one of OpenAI's stock voices). */
export const DEFAULT_TTS_VOICE = 'onyx';
export const DEFAULT_GEMINI_MODEL = 'google/gemini-3.8-flash-tts';
export const DEFAULT_GEMINI_VOICE = 'Charon';
/** The standing character, carried over from the designed Hume voice (a dry British butler turned flight director). */
export const GEMINI_CHARACTER = 'Mission control narrating a board game night: an older British man with a deep, dry baritone, ' +
  'an unflappable butler turned flight director. Measured and unhurried, wry and understated, faintly amused, never shouting';

/** "gemini,hume" -> ['gemini', 'hume']; 'openai' (the local server, always last) and unknown names are left out. */
export function parseTtsOrder(raw: string | undefined): PaidTts[] {
  const out: PaidTts[] = [];
  for (const p of (raw ?? '').toLowerCase().split(/[\s,]+/)) if ((p === 'gemini' || p === 'hume') && !out.includes(p)) out.push(p);
  return out;
}

export function configFromEnv(env = process.env): NarratorConfig {
  const version = env.NARRATOR_HUME_VERSION === '1' ? '1' : '2';
  return {
    llmUrl: (env.NARRATOR_LLM_URL || env.LOCAL_VLM_URL || '').replace(/\/$/, ''),
    llmKey: env.NARRATOR_LLM_API_KEY ?? '',
    llmModel: env.NARRATOR_LLM_MODEL || env.LOCAL_VLM_MODEL || '',
    llmTimeoutMs: Number(env.NARRATOR_LLM_TIMEOUT_MS ?? 6000),
    ttsUrl: (env.NARRATOR_TTS_URL ?? '').replace(/\/$/, ''),
    ttsKey: env.NARRATOR_TTS_API_KEY ?? '',
    ttsModel: env.NARRATOR_TTS_MODEL || 'tts-1',
    ttsVoice: env.NARRATOR_VOICE || DEFAULT_TTS_VOICE,
    ttsTimeoutMs: Number(env.NARRATOR_TTS_TIMEOUT_MS ?? 8000),
    // Paid voices are opt-in: without NARRATOR_TTS_PROVIDER only the OpenAI-compatible server speaks.
    ttsOrder: parseTtsOrder(env.NARRATOR_TTS_PROVIDER),
    gemini: {
      url: (env.NARRATOR_GEMINI_URL || 'https://openrouter.ai/api/v1').replace(/\/$/, ''),
      key: env.OPENROUTER_API_KEY ?? '',
      model: env.NARRATOR_GEMINI_MODEL || DEFAULT_GEMINI_MODEL,
      voice: env.NARRATOR_GEMINI_VOICE || DEFAULT_GEMINI_VOICE,
      character: env.NARRATOR_GEMINI_STYLE || GEMINI_CHARACTER,
      tags: env.NARRATOR_GEMINI_TAGS !== 'false',
      timeoutMs: Number(env.NARRATOR_GEMINI_TIMEOUT_MS ?? 8000),
      usdPerAudioMin: Number(env.NARRATOR_GEMINI_USD_PER_MIN ?? 0.0174),
    },
    hume: {
      url: (env.NARRATOR_HUME_URL ?? 'https://api.hume.ai').replace(/\/$/, ''),
      key: env.HUME_API_KEY ?? '',
      voiceId: env.NARRATOR_HUME_VOICE_ID ?? '',
      version,
      // Octave 2 rejects a request that carries a description, so notes go out only on Octave 1 unless forced.
      acting: env.NARRATOR_HUME_ACTING ? env.NARRATOR_HUME_ACTING === 'true' : version === '1',
      timeoutMs: Number(env.NARRATOR_HUME_TIMEOUT_MS ?? 6000),
      usdPer1kChars: Number(env.NARRATOR_HUME_USD_PER_1K ?? 0.0076),
    },
    budgetUsd: Number(env.NARRATOR_TTS_BUDGET_USD ?? 0.5),
  };
}

/** Mission control needs an LLM; without NARRATOR_LLM_URL (or LOCAL_VLM_URL) and a model the feature is off. */
export const narratorAvailable = (cfg: NarratorConfig) => !!cfg.llmUrl && !!cfg.llmModel;
/** Does this paid voice have what it needs (a key)? */
export const paidReady = (cfg: NarratorConfig, p: PaidTts) => (p === 'gemini' ? !!cfg.gemini.key : !!cfg.hume.key);
/** "Text + voice" needs a speech provider: a paid voice in the order with its key, or an OpenAI-compatible server. */
export const voiceAvailable = (cfg: NarratorConfig) => !!cfg.ttsUrl || cfg.ttsOrder.some((p) => paidReady(cfg, p));

const bearer = (key: string): Record<string, string> => (key ? {Authorization: `Bearer ${key}`} : {});

/**
 * A speech provider's refusal. `quota` marks an account out of credits (Hume E0300 zero_credits, OpenRouter 402 or
 * a spent key limit): the caller backs off that provider for a while, since every line would fail the same way.
 */
export class SpeechError extends Error {
  constructor(message: string, readonly status: number | null = null, readonly quota = false) { super(message); }
}

/** Is this error reply an account out of credits? */
export function isOutOfCredits(status: number, body: string): boolean {
  if (status === 402) return true;
  return /E0300|zero_credits|exhausted credit|insufficient[ _]credits|requires more credits|key limit exceeded|out of credits/i.test(body);
}

async function refusal(who: string, r: Response): Promise<SpeechError> {
  const body = await r.text().catch(() => '');
  const detail = body.replace(/\s+/g, ' ').slice(0, 160);
  return new SpeechError(`${who} ${r.status}${detail ? `: ${detail}` : ''}`, r.status, isOutOfCredits(r.status, body));
}

export async function writeLine(cfg: NarratorConfig, messages: ChatMessage[]): Promise<string> {
  if (!cfg.llmUrl) throw new Error('no LLM configured');
  const r = await fetch(`${cfg.llmUrl}/chat/completions`, {
    method: 'POST', signal: AbortSignal.timeout(cfg.llmTimeoutMs), headers: {'Content-Type': 'application/json', ...bearer(cfg.llmKey ?? '')},
    body: JSON.stringify({model: cfg.llmModel, temperature: 1.0, top_p: 0.95, max_tokens: 90, messages,
      chat_template_kwargs: {enable_thinking: false}}),
  });
  if (!r.ok) throw new Error(`LLM ${r.status}`);
  const j = await r.json() as {choices?: Array<{message?: {content?: string}}>};
  const text = j.choices?.[0]?.message?.content;
  if (typeof text !== 'string') throw new Error('LLM reply had no text');
  return text;
}

/** The openai-compatible server (openedai-speech): the fallback voice. */
export async function speak(cfg: NarratorConfig, text: string): Promise<Buffer> {
  if (!cfg.ttsUrl) throw new SpeechError('no speech server configured');
  const r = await fetch(`${cfg.ttsUrl}/audio/speech`, {
    method: 'POST', signal: AbortSignal.timeout(cfg.ttsTimeoutMs), headers: {'Content-Type': 'application/json', ...bearer(cfg.ttsKey ?? '')},
    body: JSON.stringify({model: cfg.ttsModel, voice: cfg.ttsVoice, input: text, response_format: 'mp3'}),
  });
  if (!r.ok) throw new SpeechError(`TTS ${r.status}`, r.status);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length < 1000) throw new SpeechError('TTS returned too little audio');
  return buf;
}

/** What one Hume line is estimated to cost: Hume bills by input characters. */
export function humeCostUsd(cfg: NarratorConfig, text: string): number {
  return text.length * cfg.hume.usdPer1kChars / 1000;
}

/**
 * Hume Octave, streamed and collected into one MP3 (the streaming endpoint hands over the whole file
 * sooner than the plain one: p50 1.6 s against 1.8 s on Octave 2). The timeout covers the whole body.
 * The streaming endpoint answers a refused request (an account out of credits, for one) with 200 and no audio, so an
 * empty stream is asked again on the plain endpoint, which returns either the audio or the real error (E0300).
 */
export async function speakHume(cfg: NarratorConfig, text: string, note?: string): Promise<Buffer> {
  const h = cfg.hume;
  if (!h.key) throw new SpeechError('no Hume key');
  // without NARRATOR_HUME_VOICE_ID, Hume picks a voice from the acting note or its default
  const utterance: Record<string, unknown> = h.voiceId ? {text, voice: {id: h.voiceId}} : {text};
  if (h.acting && note) utterance.description = note;
  const signal = AbortSignal.timeout(h.timeoutMs);
  const body = JSON.stringify({utterances: [utterance], format: {type: 'mp3'}, version: h.version, strip_headers: true});
  const headers = {'Content-Type': 'application/json', 'X-Hume-Api-Key': h.key, 'User-Agent': 'mars-ledger/narrator'};
  const r = await fetch(`${h.url}/v0/tts/stream/file`, {method: 'POST', signal, headers, body});
  if (!r.ok) throw await refusal('Hume', r);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length >= 1000) return buf;
  if (buf.length > 0) throw new SpeechError('Hume returned too little audio');
  const plain = await fetch(`${h.url}/v0/tts/file`, {method: 'POST', signal, headers, body});
  if (!plain.ok) throw await refusal('Hume', plain);
  const again = Buffer.from(await plain.arrayBuffer());
  if (again.length < 1000) throw new SpeechError('Hume returned too little audio');
  return again;
}

// ---- Gemini TTS through OpenRouter ---------------------------------------------------------------
// Gemini reads `input` verbatim (a direction written into the text is spoken aloud), so the delivery goes elsewhere:
// the sustained style as `speech_metadata.style` in OpenRouter's provider options for Google, and momentary events
// (a pause, a sigh, a laugh) as inline tags in the transcript. OpenRouter ignores a top-level `instructions` or
// `speech_metadata` for this model; only the provider option changes the delivery.
// Gemini returns raw 16-bit PCM only (mp3 is refused), which is wrapped in a WAV header for the TV.

/** Notes that suit a sigh before the line, or a short laugh after its punch line. */
const SIGH_NOTE = /\b(weary|resigned|exasperated|rueful|tired|patience)\b/;
const LAUGH_NOTE = /\b(glee|gleeful|amused|delight|delighted|jubilant|mischievous|playful|teasing)\b/;

/** The words as they should be said: card-game shorthand spelt out (the caption keeps the shorthand). */
export function spokenText(text: string): string {
  return text
    .replace(/(\d)\s*M€/g, '$1 megacredits').replace(/\bM€/g, 'megacredits')
    .replace(/(\d)\s*°?\s*C\b(?!['’]\w)/g, '$1 degrees');
}

/**
 * The transcript Gemini reads: the spoken words with inline tags for the line's beats. A two-sentence line (what
 * happened, then the quip) gets a short pause before its last sentence, a dash or ellipsis becomes one, a weary note
 * opens with a sigh and a gleeful one ends on a laugh. At most three tags.
 */
export function geminiTranscript(text: string, note: string, tags = true): string {
  let t = spokenText(text);
  if (!tags) return t;
  let n = 0;
  const tag = (x: string) => (n++ < 3 ? x : ' ');
  t = t.replace(/\s*(?:…|\.\.\.|\s[—–]\s|\s-\s)\s*/g, () => tag(' <short pause> '));
  const sentences = t.split(/(?<=[.!?])\s+(?=[A-Z0-9])/);
  if (sentences.length >= 2 && n < 3) {
    const last = sentences.pop()!;
    t = `${sentences.join(' ')} ${tag('<short pause> ')}${last}`;
  }
  const lower = note.toLowerCase();
  if (SIGH_NOTE.test(lower) && n < 3) t = `${tag('<sigh>')} ${t}`;
  else if (LAUGH_NOTE.test(lower) && n < 3) t = `${t} ${tag('<laugh>')}`;
  return t.replace(/\s+/g, ' ').trim();
}

/** The style direction: the narrator's standing character, then how to say this line. */
export function geminiStyle(cfg: NarratorConfig, note: string): string {
  const base = cfg.gemini.character.trim().replace(/[.\s]+$/, '');
  return note ? `${base}. For this line: ${note}.` : `${base}.`;
}

export function geminiRequest(cfg: NarratorConfig, text: string, note: string): Record<string, unknown> {
  const g = cfg.gemini;
  const google = {speech_metadata: {style: geminiStyle(cfg, note)}};
  return {model: g.model, voice: g.voice, input: geminiTranscript(text, note, g.tags), response_format: 'pcm',
    // keyed by OpenRouter's provider slug; only the serving provider's options are forwarded
    provider: {options: {'google-ai-studio': google, 'google-vertex': google}}};
}

/** What one Gemini line is estimated to cost before it is made (styled speech runs about 10 characters a second). */
export function geminiEstimateUsd(cfg: NarratorConfig, text: string): number {
  return text.length / 10 / 60 * cfg.gemini.usdPerAudioMin;
}

/** What a Gemini line cost, from the audio it returned. */
export function geminiCostUsd(cfg: NarratorConfig, audioMs: number): number {
  return audioMs / 60_000 * cfg.gemini.usdPerAudioMin;
}

/** Gemini TTS via OpenRouter's /audio/speech: returns a WAV file. */
export async function speakGemini(cfg: NarratorConfig, text: string, note: string): Promise<Buffer> {
  const g = cfg.gemini;
  if (!g.key) throw new SpeechError('no OpenRouter key');
  const r = await fetch(`${g.url}/audio/speech`, {
    method: 'POST', signal: AbortSignal.timeout(g.timeoutMs),
    headers: {'Content-Type': 'application/json', 'User-Agent': 'mars-ledger/narrator', ...bearer(g.key)},
    body: JSON.stringify(geminiRequest(cfg, text, note)),
  });
  if (!r.ok) throw await refusal('OpenRouter', r);
  const pcm = Buffer.from(await r.arrayBuffer());
  if (pcm.length < 4800) throw new SpeechError('Gemini returned too little audio');
  const type = r.headers.get('content-type') ?? '';
  if (/mpeg|mp3/.test(type)) return pcm;
  const rate = Number(/rate=(\d+)/.exec(type)?.[1] ?? 24000);
  const channels = Number(/channels=(\d+)/.exec(type)?.[1] ?? 1);
  return wavFromPcm(pcm, rate, channels);
}

/** A 16-bit PCM WAV file around raw samples. */
export function wavFromPcm(pcm: Buffer, rate: number, channels = 1): Buffer {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0, 'latin1'); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8, 'latin1');
  h.write('fmt ', 12, 'latin1'); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * channels * 2, 28); h.writeUInt16LE(channels * 2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36, 'latin1'); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

/** Duration in ms of a PCM WAV file, or null if it is not one. */
export function wavDurationMs(b: Buffer): number | null {
  if (b.length < 44 || b.toString('latin1', 0, 4) !== 'RIFF' || b.toString('latin1', 8, 12) !== 'WAVE') return null;
  let i = 12; let byteRate = 0;
  while (i + 8 <= b.length) {
    const id = b.toString('latin1', i, i + 4); const size = b.readUInt32LE(i + 4);
    if (id === 'fmt ') byteRate = b.readUInt32LE(i + 16);
    if (id === 'data') return byteRate ? Math.round(Math.min(size, b.length - i - 8) / byteRate * 1000) : null;
    i += 8 + size + (size & 1);
  }
  return null;
}

/** 'wav' or 'mp3', for the file name and content type. */
export const audioExt = (b: Buffer): 'wav' | 'mp3' => (b.toString('latin1', 0, 4) === 'RIFF' ? 'wav' : 'mp3');
/** Duration of either kind of audio the voices return. */
export const audioDurationMs = (b: Buffer): number | null => (audioExt(b) === 'wav' ? wavDurationMs(b) : mp3DurationMs(b));

// ---- MP3 duration, by walking frame headers (no ffmpeg in the container) ----------------------
const BITRATES: Record<string, number[]> = {
  // [MPEG version][layer 3] kbps by index
  v1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  v2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const RATES: Record<number, number[]> = {3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000]};

/** Duration in ms of an MPEG layer III stream, or null if it is not one. */
export function mp3DurationMs(b: Buffer): number | null {
  let i = 0;
  // skip an ID3v2 tag
  if (b.length > 10 && b.toString('latin1', 0, 3) === 'ID3') i = 10 + ((b[6] & 0x7f) << 21 | (b[7] & 0x7f) << 14 | (b[8] & 0x7f) << 7 | (b[9] & 0x7f));
  let samples = 0; let rate = 0; let frames = 0;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) { i++; continue; }
    const version = (b[i + 1] >> 3) & 3; // 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
    const layer = (b[i + 1] >> 1) & 3; // 1 = layer III
    const bri = b[i + 2] >> 4; const sri = (b[i + 2] >> 2) & 3; const pad = (b[i + 2] >> 1) & 1;
    if (version === 1 || layer !== 1 || bri === 0 || bri === 15 || sri === 3) { i++; continue; }
    const kbps = (version === 3 ? BITRATES.v1 : BITRATES.v2)[bri];
    rate = RATES[version][sri];
    const perFrame = version === 3 ? 1152 : 576;
    const len = Math.floor((version === 3 ? 144 : 72) * kbps * 1000 / rate) + pad;
    if (len < 4) { i++; continue; }
    samples += perFrame; frames++;
    i += len;
  }
  if (!frames || !rate) return null;
  return Math.round(samples / rate * 1000);
}

// ---- reachability (for /api/health; never on the line's path) ---------------------------------
export type Reach = {reachable: boolean; error?: string};

/** Does the LLM answer, and does it serve the configured model? A cheap GET of its model list. */
export async function probeLlm(cfg: NarratorConfig, timeoutMs = 2000): Promise<Reach> {
  if (!cfg.llmUrl) return {reachable: false, error: 'no LLM configured'};
  try {
    const r = await fetch(`${cfg.llmUrl}/models`, {signal: AbortSignal.timeout(timeoutMs), headers: bearer(cfg.llmKey ?? '')});
    if (!r.ok) return {reachable: false, error: `LLM ${r.status}`};
    const j = await r.json().catch(() => null) as {data?: Array<{id?: string}>} | null;
    const ids = (j?.data ?? []).map((m) => m.id).filter((x): x is string => typeof x === 'string');
    if (ids.length && !ids.includes(cfg.llmModel)) return {reachable: false, error: `model ${cfg.llmModel} not served (has ${ids.slice(0, 4).join(', ')})`};
    return {reachable: true};
  } catch (e) {
    return {reachable: false, error: (e as Error).name === 'TimeoutError' ? 'LLM timed out' : `LLM unreachable (${(e as Error).message})`};
  }
}

/**
 * Does Hume answer with this key? Lists one of the account's voices (free; no speech is made). A 200 here says
 * nothing about credits: an account with none still lists its voices, so the caller combines this with what the
 * last real request said.
 */
export async function probeHume(cfg: NarratorConfig, timeoutMs = 3000): Promise<Reach> {
  const h = cfg.hume;
  if (!h.key) return {reachable: false, error: 'no Hume key'};
  try {
    const r = await fetch(`${h.url}/v0/tts/voices?provider=CUSTOM_VOICE&page_size=1`, {signal: AbortSignal.timeout(timeoutMs),
      headers: {'X-Hume-Api-Key': h.key, 'User-Agent': 'mars-ledger/narrator'}});
    return r.ok ? {reachable: true} : {reachable: false, error: `Hume ${r.status}`};
  } catch (e) {
    return {reachable: false, error: (e as Error).name === 'TimeoutError' ? 'Hume timed out' : `Hume unreachable (${(e as Error).message})`};
  }
}

/**
 * Does OpenRouter answer with this key, and is there money to speak with? Reads the key's limit and the account's
 * credit balance (both free); a key or account with nothing left is reported as out of credits.
 */
export async function probeGemini(cfg: NarratorConfig, timeoutMs = 3000): Promise<Reach & {outOfCredits?: boolean}> {
  const g = cfg.gemini;
  if (!g.key) return {reachable: false, error: 'no OpenRouter key'};
  const get = (p: string) => fetch(`${g.url}/${p}`, {signal: AbortSignal.timeout(timeoutMs), headers: {'User-Agent': 'mars-ledger/narrator', ...bearer(g.key)}});
  try {
    const r = await get('key');
    if (!r.ok) return {reachable: false, error: `OpenRouter ${r.status}`};
    const k = (await r.json().catch(() => null) as {data?: {limit_remaining?: number | null}} | null)?.data;
    if (typeof k?.limit_remaining === 'number' && k.limit_remaining <= 0) return {reachable: true, outOfCredits: true, error: 'OpenRouter key limit reached'};
    const c = await get('credits').catch(() => null);
    if (c?.ok) {
      const d = (await c.json().catch(() => null) as {data?: {total_credits?: number; total_usage?: number}} | null)?.data;
      if (typeof d?.total_credits === 'number' && typeof d.total_usage === 'number' && d.total_credits - d.total_usage <= 0) {
        return {reachable: true, outOfCredits: true, error: 'OpenRouter is out of credits'};
      }
    }
    return {reachable: true};
  } catch (e) {
    return {reachable: false, error: (e as Error).name === 'TimeoutError' ? 'OpenRouter timed out' : `OpenRouter unreachable (${(e as Error).message})`};
  }
}
