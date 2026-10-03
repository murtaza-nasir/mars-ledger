// Mission control's Gemini voice (Gemini 3.8 Flash TTS through OpenRouter) and paid voices running out of credits.
// Covers the request (style direction and inline tags), the provider order and fallback, the
// out-of-credits detection with its 10-minute back-off, and what /api/health and the TV options say about it.
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import type {AddressInfo} from 'node:net';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {narratorStatus} from '../src/shared/narrator';
import type {NarrationLine, NarratorMode} from '../src/shared/narrator';
import {CREDIT_BACKOFF_MS, fitsLine, Narrator} from '../src/server/narrator';
import type {NarratorEvent} from '../src/server/narrator/detect';
import {Scheduler} from '../src/server/narrator/schedule';
import {configFromEnv, DEFAULT_GEMINI_MODEL, DEFAULT_GEMINI_VOICE, GEMINI_CHARACTER, geminiRequest, geminiTranscript, isOutOfCredits,
  parseTtsOrder, probeGemini, spokenText, voiceAvailable, wavDurationMs, wavFromPcm} from '../src/server/narrator/services';
import type {NarratorConfig} from '../src/server/narrator/services';

type Req = {method?: string; url?: string; headers: http.IncomingHttpHeaders; body: Record<string, unknown>};
type Mock = {url: string; close: () => Promise<void>; calls: number; seen: Req[]};
async function mockServer(handler: (r: Req, res: http.ServerResponse) => void): Promise<Mock> {
  const m: Mock = {url: '', close: async () => {}, calls: 0, seen: []};
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      m.calls++;
      let body: Record<string, unknown> = {};
      try { body = raw ? JSON.parse(raw) as Record<string, unknown> : {}; } catch { /* not json */ }
      const r = {method: req.method, url: req.url, headers: req.headers, body};
      m.seen.push(r);
      handler(r, res);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  m.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  m.close = () => new Promise((r) => { server.closeAllConnections(); server.close(() => r()); });
  return m;
}
const mocks: Mock[] = [];
afterEach(async () => { await Promise.all(mocks.splice(0).map((m) => m.close())); vi.restoreAllMocks(); });

const LINE = 'Big Asteroid lands. Ada has 4 fewer plants to water.';
const MP3 = fs.readFileSync(path.join(__dirname, 'fixtures/narrator/tone.mp3'));
/** Raw 16-bit mono PCM at 24 kHz, as Gemini returns it: `ms` of a quiet tone. */
const pcm = (ms: number) => {
  const b = Buffer.alloc(Math.round(ms * 48));
  for (let i = 0; i < b.length / 2; i++) b.writeInt16LE(Math.round(Math.sin(i / 10) * 3000), i * 2);
  return b;
};
const PCM_HEADERS = {'Content-Type': 'audio/pcm;rate=24000;channels=1', 'X-Generation-Id': 'gen-tts-test'};

const llm = (content: string) => mockServer((r, res) => {
  if (r.url?.endsWith('/models')) { res.writeHead(200, {'Content-Type': 'application/json'}).end(JSON.stringify({data: [{id: 'm'}]})); return; }
  res.writeHead(200, {'Content-Type': 'application/json'}).end(JSON.stringify({choices: [{message: {content}}]}));
});
/** An OpenRouter stand-in: /audio/speech answers with `speech`, /key and /credits with the given balance. */
const openRouter = (speech: (res: http.ServerResponse) => void, balance = {credits: 10, usage: 1}) => mockServer((r, res) => {
  if (r.url?.endsWith('/key')) { res.writeHead(200, {'Content-Type': 'application/json'}).end(JSON.stringify({data: {limit: null, limit_remaining: null, usage: 0}})); return; }
  if (r.url?.endsWith('/credits')) { res.writeHead(200, {'Content-Type': 'application/json'}).end(JSON.stringify({data: {total_credits: balance.credits, total_usage: balance.usage}})); return; }
  speech(res);
});
const geminiOk = (ms = 4000) => (res: http.ServerResponse) => res.writeHead(200, PCM_HEADERS).end(pcm(ms));

function cfg(o: Partial<NarratorConfig> & {geminiUrl?: string; humeUrl?: string} = {}): NarratorConfig {
  const base = configFromEnv({OPENROUTER_API_KEY: 'or-key', HUME_API_KEY: 'hume-key', NARRATOR_HUME_VOICE_ID: 'voice-x'});
  const {geminiUrl, humeUrl, ...rest} = o;
  return {...base, llmModel: 'm', llmTimeoutMs: 1500, ttsVoice: 'onyx', ttsTimeoutMs: 2000, ttsOrder: ['gemini'],
    gemini: {...base.gemini, url: geminiUrl ?? 'http://127.0.0.1:9/v1', timeoutMs: 1500},
    hume: {...base.hume, url: (humeUrl ?? 'http://127.0.0.1:9').replace(/\/v1$/, ''), timeoutMs: 1500}, ...rest};
}

function narrator(mode: NarratorMode, config: NarratorConfig, now?: () => number) {
  const lines: NarrationLine[] = [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narrator-gemini-'));
  const logPath = path.join(dir, 'qa.jsonl');
  const n = new Narrator({mode: () => mode, toTv: (l) => lines.push(l), players: () => ['Ada', 'Vera'], corporations: () => [], dataDir: dir,
    pumpMs: 0, logPath, config, now});
  // no spacing between lines, and moments never go stale (some tests move the clock on by minutes)
  (n as unknown as {scheduler: Scheduler}).scheduler = new Scheduler(0, 1e12);
  const qa = () => (fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>) : []);
  return {n, lines, qa};
}
const attack = (): NarratorEvent => ({key: `atk-${Math.random()}`, kind: 'attack', priority: 4, focus: 'an attack', at: Date.now(),
  facts: ['Vera played Big Asteroid.', 'Ada lost 4 plants.'], names: ['Vera', 'Ada'], cards: ['Big Asteroid']});
async function say(n: Narrator) {
  (n as unknown as {scheduler: Scheduler}).scheduler.offer([attack()]);
  await n.pump();
}

describe('Gemini request', () => {
  const c = cfg();

  it('sends the acting note as the style direction after the standing character, in Google\'s provider option', () => {
    const body = geminiRequest(c, LINE, 'withering sarcasm');
    expect(body).toMatchObject({model: DEFAULT_GEMINI_MODEL, voice: DEFAULT_GEMINI_VOICE, response_format: 'pcm'});
    const style = `${GEMINI_CHARACTER}. For this line: withering sarcasm.`;
    expect(body.provider).toEqual({options: {'google-ai-studio': {speech_metadata: {style}}, 'google-vertex': {speech_metadata: {style}}}});
    // OpenRouter ignores these for Gemini, and a direction in the text would be read aloud
    expect(body).not.toHaveProperty('instructions');
    expect(body).not.toHaveProperty('speech_metadata');
    expect(String(body.input)).not.toMatch(/sarcasm|For this line/);
    expect(GEMINI_CHARACTER).toMatch(/British/);
    expect(GEMINI_CHARACTER).toMatch(/dry/);
  });

  it('marks the beats with inline tags: a pause before the quip, a sigh for weary notes, a laugh for gleeful ones', () => {
    expect(geminiTranscript(LINE, 'withering sarcasm')).toBe('Big Asteroid lands. <short pause> Ada has 4 fewer plants to water.');
    expect(geminiTranscript('Generation 7 wrapped: 2 C warmer.', 'weary patience')).toBe('<sigh> Generation 7 wrapped: 2 degrees warmer.');
    expect(geminiTranscript('Vera takes the lead. Ada notices.', 'barely contained glee')).toBe('Vera takes the lead. <short pause> Ada notices. <laugh>');
    expect(geminiTranscript('A bold move… the treasury weeps', 'dry, deadpan')).toBe('A bold move <short pause> the treasury weeps');
    // three sentences: only the last one waits for the pause
    expect(geminiTranscript('One. Two. Three.', 'mock-solemn')).toBe('One. Two. <short pause> Three.');
    // at most three tags
    const many = geminiTranscript('A — b — c — d. Then e.', 'weary patience');
    expect((many.match(/<[a-z ]+>/g) ?? []).length).toBe(3);
    expect(geminiTranscript(LINE, 'weary patience', false)).toBe(LINE);
  });

  it('spells out card-game shorthand for the ear; the caption keeps it', () => {
    expect(spokenText('Ada spent 27 M€ on a Space Elevator.')).toBe('Ada spent 27 megacredits on a Space Elevator.');
    expect(spokenText('2 C warmer, 3 °C in all, 4 Cities untouched.')).toBe('2 degrees warmer, 3 degrees in all, 4 Cities untouched.');
  });

  it('reads the order and the Gemini settings from the environment', () => {
    expect(parseTtsOrder('gemini')).toEqual(['gemini']);
    expect(parseTtsOrder('Gemini, hume, openai, nonsense, gemini')).toEqual(['gemini', 'hume']);
    const e = configFromEnv({NARRATOR_TTS_PROVIDER: 'gemini', OPENROUTER_API_KEY: 'k', NARRATOR_GEMINI_VOICE: 'Algenib'});
    expect(e.ttsOrder).toEqual(['gemini']);
    expect(e.gemini).toMatchObject({url: 'https://openrouter.ai/api/v1', model: 'google/gemini-3.8-flash-tts', voice: 'Algenib', tags: true, timeoutMs: 8000});
    expect(voiceAvailable(e)).toBe(true);
    // an OpenRouter key for photo scanning does not make mission control speak through paid Gemini
    expect(voiceAvailable(configFromEnv({OPENROUTER_API_KEY: 'k'}))).toBe(false);
    expect(configFromEnv({NARRATOR_GEMINI_TAGS: 'false', NARRATOR_GEMINI_STYLE: 'A cheerful robot'}).gemini).toMatchObject({tags: false, character: 'A cheerful robot'});
  });

  it('wraps Gemini\'s raw PCM in a WAV whose length is measured like an MP3\'s', () => {
    const wav = wavFromPcm(pcm(4000), 24000);
    expect(wav.toString('latin1', 0, 4)).toBe('RIFF');
    expect(wavDurationMs(wav)).toBe(4000);
    expect(wavDurationMs(MP3)).toBeNull();
    expect(fitsLine(wav, LINE)).toBe(4000);
    expect(fitsLine(wavFromPcm(pcm(500), 24000), LINE)).toBeNull();
  });
});

describe('Gemini voice in the pipeline', () => {
  it('speaks with Gemini first: the caption has no tags or note, the audio is a WAV, the cost comes from its length', async () => {
    const m = await llm(`${LINE}\nDelivery: withering sarcasm`);
    const or = await openRouter(geminiOk(4000));
    const local = await mockServer((_r, res) => res.writeHead(200).end(MP3));
    mocks.push(m, or, local);
    const {n, lines, qa} = narrator('voice', cfg({llmUrl: m.url, ttsUrl: local.url, geminiUrl: or.url}));
    await say(n);
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toBe(LINE);
    expect(JSON.stringify(lines[0])).not.toMatch(/<|sarcasm|Delivery/);
    expect(lines[0].audioUrl).toMatch(/^\/api\/narration\/n[a-z0-9]+\.wav$/);
    expect(lines[0].audioMs).toBe(4000);
    expect(n.audioPath(lines[0].audioUrl!.split('/').pop()!)).not.toBeNull();
    expect(local.calls).toBe(0);
    const req = or.seen.find((r) => r.url === '/v1/audio/speech')!;
    expect(req.headers.authorization).toBe('Bearer or-key');
    expect(req.body).toMatchObject({input: 'Big Asteroid lands. <short pause> Ada has 4 fewer plants to water.', response_format: 'pcm'});
    expect(JSON.stringify(req.body.provider)).toContain('For this line: withering sarcasm.');
    expect(qa().find((e) => e.result === 'sent')).toMatchObject({tts: 'gemini', act: 'withering sarcasm'});
    expect(n.spend).toMatchObject({paidLines: 1, byProvider: {gemini: 1}});
    expect(n.spend.paidUsd).toBeCloseTo(4 / 60 * 0.0174, 8);
    n.stop();
  });

  it('Gemini failing or too slow falls back to the local voice, with the reason in the QA log', async () => {
    const m = await llm(LINE);
    const broken = await openRouter((res) => res.writeHead(500).end('{"error":{"message":"upstream"}}'));
    const slow = await openRouter((res) => { setTimeout(() => geminiOk()(res), 1500); });
    const local = await mockServer((_r, res) => res.writeHead(200).end(MP3));
    mocks.push(m, broken, slow, local);
    for (const [url, reason] of [[broken.url, 'gemini-error'], [slow.url, 'gemini-timeout']] as const) {
      const c = cfg({llmUrl: m.url, ttsUrl: local.url, geminiUrl: url});
      const {n, lines, qa} = narrator('voice', {...c, gemini: {...c.gemini, timeoutMs: 300}});
      await say(n);
      expect(lines[0].audioUrl).toMatch(/\.mp3$/);
      expect(qa().find((e) => e.result === 'sent')).toMatchObject({tts: 'openai', fallback: reason});
      expect(n.spend.fallbacks[reason]).toBe(1);
      n.stop();
    }
  });

  it('tries the paid voices in order: Gemini, then Hume, then the local voice', async () => {
    const m = await llm(LINE);
    const broken = await openRouter((res) => res.writeHead(503).end('busy'));
    const hume = await mockServer((_r, res) => res.writeHead(200, {'Content-Type': 'audio/mpeg'}).end(MP3));
    const local = await mockServer((_r, res) => res.writeHead(200).end(MP3));
    mocks.push(m, broken, hume, local);
    const {n, lines, qa} = narrator('voice', cfg({llmUrl: m.url, ttsUrl: local.url, geminiUrl: broken.url, humeUrl: hume.url, ttsOrder: ['gemini', 'hume']}));
    await say(n);
    expect(lines[0].audioUrl).toMatch(/\.mp3$/);
    expect(hume.calls).toBe(1);
    expect(local.calls).toBe(0);
    expect(qa().find((e) => e.result === 'sent')).toMatchObject({tts: 'hume', fallback: 'gemini-error'});
    n.stop();
  });

  it('the per-game budget covers Gemini too', async () => {
    const m = await llm(LINE);
    const or = await openRouter(geminiOk(4000));
    const local = await mockServer((_r, res) => res.writeHead(200).end(MP3));
    mocks.push(m, or, local);
    // one 4 s line costs about $0.00116; the estimate for the next one no longer fits a $0.002 budget
    const {n, lines} = narrator('voice', cfg({llmUrl: m.url, ttsUrl: local.url, geminiUrl: or.url, budgetUsd: 0.002}));
    await say(n); await say(n);
    expect(lines).toHaveLength(2);
    expect(or.seen.filter((r) => r.url === '/v1/audio/speech')).toHaveLength(1);
    expect(n.spend).toMatchObject({paidLines: 1, overBudget: true, fallbacks: {budget: 1}});
    n.stop();
  });
});

describe('paid voices out of credits', () => {
  it('recognises Hume\'s E0300 and OpenRouter\'s 402, and nothing else', () => {
    expect(isOutOfCredits(400, '{"status_code":400,"message":"Exhausted credit balance.","details":{"code":"E0300","slug":"zero_credits"}}')).toBe(true);
    expect(isOutOfCredits(402, '{"error":{"message":"Insufficient credits. Add more using https://openrouter.ai/credits","code":402}}')).toBe(true);
    expect(isOutOfCredits(403, '{"error":{"message":"Key limit exceeded"}}')).toBe(true);
    expect(isOutOfCredits(400, 'Octave 2 does not support the \'description\' parameter')).toBe(false);
    expect(isOutOfCredits(429, 'rate limited')).toBe(false);
    expect(isOutOfCredits(500, 'upstream error')).toBe(false);
  });

  it('OpenRouter 402: the local voice speaks, Gemini rests 10 minutes, and health and the TV say why', async () => {
    const m = await llm(LINE);
    let broke = true;
    const or = await openRouter((res) => (broke
      ? res.writeHead(402, {'Content-Type': 'application/json'}).end('{"error":{"message":"Insufficient credits. Add more using https://openrouter.ai/credits","code":402}}')
      : geminiOk()(res)));
    const local = await mockServer((_r, res) => res.writeHead(200).end(MP3));
    mocks.push(m, or, local);
    let now = Date.now();
    const {n, lines, qa} = narrator('voice', cfg({llmUrl: m.url, ttsUrl: local.url, geminiUrl: or.url}), () => now);
    const speechCalls = () => or.seen.filter((r) => r.url === '/v1/audio/speech').length;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await say(n);
    expect(lines[0].audioUrl).toMatch(/\.mp3$/);
    expect(qa().find((e) => e.result === 'sent')).toMatchObject({tts: 'openai', fallback: 'gemini-no-credits'});
    const h = await n.health() as {mode: string; llm: {reachable: boolean}; speech: {lastError: string; outOfCredits: {provider: string; account: string; backoffLeftS: number; instead: string};
      providers: {gemini: {reachable: boolean; ok: boolean; outOfCredits: boolean}}}};
    expect(h.speech.lastError).toMatch(/^OpenRouter is out of credits/);
    expect(h.speech.outOfCredits).toMatchObject({provider: 'gemini', account: 'OpenRouter', backoffLeftS: 600, instead: 'using the backup voice'});
    // the key check answers fine, yet the provider is not reported fine
    expect(h.speech.providers.gemini).toMatchObject({reachable: true, ok: false, outOfCredits: true});
    expect(narratorStatus({health: h, now, voiceLocked: false, muted: false})).toBe('Mission control: OpenRouter is out of credits, using the backup voice');
    // within the 10 minutes Gemini is not asked again
    now += 5 * 60_000;
    await say(n);
    expect(speechCalls()).toBe(1);
    expect(lines[1].audioUrl).toMatch(/\.mp3$/);
    // after them it is, and a line it speaks clears the warning
    broke = false;
    now += CREDIT_BACKOFF_MS;
    await say(n);
    expect(speechCalls()).toBe(2);
    expect(lines[2].audioUrl).toMatch(/\.wav$/);
    const after = await n.health() as {speech: {outOfCredits: unknown; providers: {gemini: {ok: boolean}}}};
    expect(after.speech.outOfCredits).toBeNull();
    expect(after.speech.providers.gemini.ok).toBe(true);
    n.stop();
  });

  it('Hume out of credits: an empty stream is asked again on the plain endpoint, whose E0300 is reported', async () => {
    const m = await llm(LINE);
    // Hume's voice list still answers 200 for an account with no credits; the stream answers 200 with no audio
    const hume = await mockServer((r, res) => {
      if (r.url?.startsWith('/v0/tts/voices')) { res.writeHead(200, {'Content-Type': 'application/json'}).end('{"voices_page":[]}'); return; }
      if (r.url === '/v0/tts/stream/file') { res.writeHead(200, {'Content-Type': 'audio/mp3'}).end(); return; }
      res.writeHead(400, {'Content-Type': 'application/json'}).end('{"status_code":400,"message":"Exhausted credit balance. Visit app.hume.ai/billing to manage your account.","details":{"type":"error","code":"E0300","slug":"zero_credits"}}');
    });
    const local = await mockServer((_r, res) => res.writeHead(200).end(MP3));
    mocks.push(m, hume, local);
    const {n, lines, qa} = narrator('voice', cfg({llmUrl: m.url, ttsUrl: local.url, humeUrl: hume.url, ttsOrder: ['hume']}));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await say(n);
    expect(hume.seen.map((r) => r.url)).toEqual(['/v0/tts/stream/file', '/v0/tts/file']);
    expect(lines[0].audioUrl).toMatch(/\.mp3$/);
    expect(qa().find((e) => e.result === 'sent')).toMatchObject({tts: 'openai', fallback: 'hume-no-credits'});
    const h = await n.health() as {mode: string; speech: {lastError: string; providers: {hume: {reachable: boolean; ok: boolean}}; outOfCredits: {account: string}}};
    expect(h.speech.lastError).toMatch(/Hume is out of credits: Hume 400: .*E0300/);
    expect(h.speech.providers.hume).toMatchObject({reachable: true, ok: false});
    expect(narratorStatus({health: h, now: Date.now(), voiceLocked: false, muted: false})).toBe('Mission control: Hume is out of credits, using the backup voice');
    await say(n);
    expect(hume.calls - 1).toBe(2); // the voice list probe, plus the two requests of the first line; none for the second
    n.stop();
  });

  it('without a backup voice the status says text only; a second paid voice is named when it still works', () => {
    const health = (speech: Record<string, unknown>) => ({mode: 'voice', llm: {reachable: true}, lastLineAt: null, speech});
    expect(narratorStatus({health: health({fallback: false, outOfCredits: {account: 'OpenRouter'}}), now: 0, voiceLocked: false, muted: false}))
      .toBe('Mission control: OpenRouter is out of credits, text only');
    expect(narratorStatus({health: health({fallback: true, outOfCredits: {account: 'Hume', instead: 'using Gemini'}}), now: 0, voiceLocked: false, muted: false}))
      .toBe('Mission control: Hume is out of credits, using Gemini');
    // text mode does not mention the voice
    expect(narratorStatus({health: {...health({outOfCredits: {account: 'Hume'}}), mode: 'text'}, now: 0, voiceLocked: false, muted: false}))
      .toBe('Mission control: no lines yet');
  });

  it('the OpenRouter check reports an account or key with nothing left before any line is spoken', async () => {
    const empty = await openRouter(geminiOk(), {credits: 5, usage: 5});
    const fine = await openRouter(geminiOk());
    mocks.push(empty, fine);
    expect(await probeGemini(cfg({geminiUrl: empty.url}))).toEqual({reachable: true, outOfCredits: true, error: 'OpenRouter is out of credits'});
    expect(await probeGemini(cfg({geminiUrl: fine.url}))).toEqual({reachable: true});
    expect(await probeGemini(cfg({geminiUrl: 'http://127.0.0.1:9/v1'}))).toMatchObject({reachable: false});
    // the speech endpoint is never called by the check
    expect(empty.seen.some((r) => r.url?.includes('audio'))).toBe(false);
  });
});
