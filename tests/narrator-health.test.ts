// Mission control's health and the TVs' reports: what /api/health says about the narrator, how a TV's report of a
// line it never showed (or never spoke) is counted and logged, and the TV layer's rules for busy stages and stale
// lines.
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import type {AddressInfo} from 'node:net';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {narratorStatus, STAGE_WAIT_MAX_MS, STORY_WAIT_MAX_MS} from '../src/shared/narrator';
import type {NarrationLine, NarratorMode} from '../src/shared/narrator';
import {Narrator} from '../src/server/narrator';
import type {NarratorEvent} from '../src/server/narrator/detect';
import type {Scheduler} from '../src/server/narrator/schedule';
import {configFromEnv, probeLlm} from '../src/server/narrator/services';
import type {NarratorConfig} from '../src/server/narrator/services';
import {HealthCheck} from '../src/server/health';
import {gateNames, pickLine, silentReason, stageHolds} from '../src/client/tv/narrator/gate';

type Mock = {url: string; close: () => Promise<void>; calls: number};
async function mockServer(handler: (req: http.IncomingMessage, res: http.ServerResponse) => void): Promise<Mock> {
  const m: Mock = {url: '', close: async () => {}, calls: 0};
  const server = http.createServer((req, res) => { req.resume(); req.on('end', () => { m.calls++; handler(req, res); }); });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  m.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  m.close = () => new Promise((r) => { server.closeAllConnections(); server.close(() => r()); });
  return m;
}
const mocks: Mock[] = [];
afterEach(async () => { await Promise.all(mocks.splice(0).map((m) => m.close())); vi.restoreAllMocks(); });

/** An OpenAI-compatible LLM: /models lists `models`, /chat/completions answers with `line`. */
const llm = (line: string, models = ['m']) => mockServer((req, res) => {
  if (req.url?.endsWith('/models')) { res.writeHead(200, {'Content-Type': 'application/json'}).end(JSON.stringify({data: models.map((id) => ({id}))})); return; }
  res.writeHead(200, {'Content-Type': 'application/json'}).end(JSON.stringify({choices: [{message: {content: line}}]}));
});
const MP3 = fs.readFileSync(path.join(__dirname, 'fixtures/narrator/tone.mp3'));

function narrator(mode: NarratorMode, llmUrl: string, ttsUrl = '') {
  const lines: NarrationLine[] = [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narrator-health-'));
  const config: NarratorConfig = {llmUrl, llmModel: 'm', llmTimeoutMs: 1500, ttsUrl, ttsModel: 't', ttsVoice: 'onyx', ttsTimeoutMs: 2000,
    ttsOrder: [], budgetUsd: 0.5, gemini: configFromEnv({}).gemini,
    hume: {url: 'http://127.0.0.1:9', key: '', voiceId: '', version: '2', acting: false, timeoutMs: 1000, usdPer1kChars: 0.0076}};
  const n = new Narrator({mode: () => mode, toTv: (l) => lines.push(l), players: () => ['Ada', 'Vera'], corporations: () => [], dataDir: dir, pumpMs: 0, config});
  return {n, lines};
}
const attack = (): NarratorEvent => ({key: `atk-${Math.random()}`, kind: 'attack', priority: 4, focus: 'an attack', at: Date.now(),
  facts: ['Vera played Big Asteroid.', 'Ada lost 4 plants.'], names: ['Vera', 'Ada'], cards: ['Big Asteroid']});
const feed = (n: Narrator, e: NarratorEvent) => (n as unknown as {scheduler: Scheduler}).scheduler.offer([e]);

describe('Narrator health', () => {
  it('reports the LLM reachable, the last line and what the TV saw', async () => {
    const m = await llm('Big Asteroid lands. Ada has 4 fewer plants to water.');
    mocks.push(m);
    const {n, lines} = narrator('text', m.url);
    feed(n, attack());
    await n.pump();
    expect(lines).toHaveLength(1);
    n.tvReport({id: lines[0].id, shown: true, spoke: false});
    const h = await n.health() as {mode: string; llm: {reachable: boolean}; linesSent: number; lastLineAt: number; tv: {shown: number; notShown: number}};
    expect(h.mode).toBe('text');
    expect(h.llm.reachable).toBe(true);
    expect(h.linesSent).toBe(1);
    expect(h.lastLineAt).toBe(lines[0].at);
    expect(h.tv).toMatchObject({shown: 1, notShown: 0});
    n.stop();
  });

  it('says when the LLM is down, with the error, and keeps the last failure', async () => {
    const {n} = narrator('voice', 'http://127.0.0.1:9/v1');
    feed(n, attack());
    await n.pump();
    const h = await n.health() as {llm: {reachable: boolean; error: string; lastError: string}; lastError: {kind: string}};
    expect(h.llm.reachable).toBe(false);
    expect(h.llm.error).toMatch(/unreachable|timed out/);
    expect(h.llm.lastError).toBeTruthy();
    expect(h.lastError.kind).toBe('llm');
    n.stop();
  });

  it('a TV that never showed a line (or never spoke a voice line) is counted and logged with its reason', async () => {
    const m = await llm('Big Asteroid lands. Ada has 4 fewer plants to water.');
    const tts = await mockServer((_req, res) => res.writeHead(200, {'Content-Type': 'audio/mpeg'}).end(MP3));
    mocks.push(m, tts);
    const {n, lines} = narrator('voice', m.url, tts.url);
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    feed(n, attack());
    await n.pump();
    expect(lines[0].audioUrl).toBeTruthy();
    n.tvReport({id: lines[0].id, shown: true, spoke: false, reason: 'sound locked: no tap or key on this TV since it loaded'});
    expect(info.mock.calls.map((c) => String(c[0])).join('\n')).toMatch(/shown but not spoken on a TV \(sound locked/);
    // a second TV that let the line expire behind a cinematic
    n.tvReport({id: lines[0].id, shown: false, spoke: false, reason: 'expired after 31 s behind a cinematic'});
    const h = await n.health() as {tv: {reports: number; shown: number; notShown: number; lastDropReason: string}};
    expect(h.tv.reports).toBe(2);
    expect(h.tv.shown).toBe(1);
    expect(h.tv.lastDropReason).toBe('not shown: expired after 31 s behind a cinematic');
    // reports about lines this server never sent are ignored
    n.tvReport({id: 'nbogus1', shown: false, spoke: false});
    expect(((await n.health()) as {tv: {reports: number}}).tv.reports).toBe(2);
    n.stop();
  });
});

describe('probeLlm', () => {
  it('is unreachable when the server does not serve the configured model', async () => {
    const m = await llm('x', ['other-model-7b']);
    mocks.push(m);
    const r = await probeLlm({llmUrl: m.url, llmModel: 'example-model-8b'} as NarratorConfig);
    expect(r).toEqual({reachable: false, error: 'model example-model-8b not served (has other-model-7b)'});
  });
});

describe('HealthCheck extra fields', () => {
  it('adds them without changing the status, and a failure is reported in their place', async () => {
    const ok = new HealthCheck({probe: async () => {}, build: () => 'b', extra: async () => ({narrator: {mode: 'voice'}})});
    expect(await ok.report()).toEqual({status: 200, body: {ok: true, engine: 'ok', build: 'b', narrator: {mode: 'voice'}}});
    const down = new HealthCheck({probe: async () => { throw new Error('down'); }, build: () => 'b', extra: async () => { throw new Error('boom'); }});
    expect(await down.report()).toEqual({status: 503, body: {ok: false, engine: 'down', error: 'down', build: 'b', extraError: 'boom'}});
    expect((await ok.report(true)).body).toEqual({ok: true, app: 'ok', build: 'b'});
  });
});

describe('TV caption gate', () => {
  const line = (id: string, at: number, ttlMs = 30_000): NarrationLine => ({id, text: 'x', kind: 'attack', at, ttlMs});

  it('a busy stage holds captions only up to the cap (longer for the end-of-game story)', () => {
    expect(stageHolds(null, 1_000, false)).toBe(false);
    expect(stageHolds(0, STAGE_WAIT_MAX_MS - 1, false)).toBe(true);
    expect(stageHolds(0, STAGE_WAIT_MAX_MS, false)).toBe(false);
    expect(stageHolds(0, STAGE_WAIT_MAX_MS + 1, true)).toBe(true);
    expect(stageHolds(0, STORY_WAIT_MAX_MS, true)).toBe(false);
  });

  it('picks the oldest fresh line and lists the ones that waited too long', () => {
    const lines = [line('a', 0), line('b', 20_000), line('c', 40_000)];
    expect(pickLine(lines, new Set(), 45_000, 0)).toEqual({next: lines[1], expired: [lines[0]]});
    expect(pickLine(lines, new Set(['b']), 45_000, 0).next).toBe(lines[2]);
    // lines from before this page loaded are not this page's to show or report
    expect(pickLine(lines, new Set(), 45_000, 30_000)).toEqual({next: lines[2], expired: []});
  });

  it('names what holds the stage, and why a voice stayed silent', () => {
    expect(gateNames({cinema: true, production: false, moment: false, flick: true, story: false})).toBe('a cinematic + a flicked card');
    expect(gateNames({cinema: false, production: false, moment: false, flick: false, story: false})).toBe('');
    expect(silentReason({muted: true, canSpeak: false})).toBe('TV sound is off');
    expect(silentReason({muted: false, canSpeak: false})).toMatch(/^sound locked/);
    expect(silentReason({muted: false, canSpeak: true})).toBeNull();
  });
});

describe('narratorStatus (TV options line)', () => {
  const now = 10 * 60_000;
  it('says how long ago the last line came, and what holds the voice back', () => {
    expect(narratorStatus({health: {mode: 'voice', llm: {reachable: true}, lastLineAt: now - 2 * 60_000}, now, voiceLocked: false, muted: false}))
      .toBe('Mission control: last line 2 min ago');
    expect(narratorStatus({health: {mode: 'voice', llm: {reachable: true}, lastLineAt: null}, now, voiceLocked: true, muted: false}))
      .toBe('Mission control: no lines yet; voice waits for a tap or key on this TV');
    expect(narratorStatus({health: {mode: 'voice', llm: {reachable: false, error: 'LLM timed out'}, lastLineAt: now}, now, voiceLocked: false, muted: false}))
      .toBe('Mission control: can’t reach the language model');
    expect(narratorStatus({health: {mode: 'off'}, now, voiceLocked: false, muted: false})).toBe('Mission control: off for this table');
    expect(narratorStatus({health: null, now, voiceLocked: false, muted: false})).toBeNull();
  });
});

describe('TV reports with a reason', () => {
  it('a line shown over a stage flag that stayed busy past the cap is logged (evidence of a stuck flag)', async () => {
    const m = await llm('Big Asteroid lands. Ada has 4 fewer plants to water.');
    mocks.push(m);
    const {n, lines} = narrator('text', m.url);
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    feed(n, attack());
    await n.pump();
    n.tvReport({id: lines[0].id, shown: true, spoke: false, reason: 'shown over a cinematic (busy past the cap)'});
    expect(info.mock.calls.map((c) => String(c[0])).join('\n')).toContain(`line ${lines[0].id} on a TV: shown over a cinematic (busy past the cap)`);
    expect(((await n.health()) as {tv: {notShown: number; lastDropReason: string | null}}).tv).toMatchObject({notShown: 0, lastDropReason: null});
    n.stop();
  });
});
