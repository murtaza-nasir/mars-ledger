// Mission control: notices notable moments, writes one short line at a time with the local LLM,
// validates it against the game's facts, optionally speaks it, and sends it to the TV.
// Detection always runs (so memory stays current); lines are made only when the table has chosen
// 'text' or 'voice'. Any service failure degrades quietly: voice -> text, text -> nothing. Speech tries the
// paid voices in order (Gemini via OpenRouter, then Hume), within a per-game
// budget, with the local voice as a per-line fallback; fallbacks and spend go to the QA log and the server log.
// An account out of credits is backed off for 10 minutes and named in /api/health and the TV options.
import * as fs from 'node:fs';
import * as path from 'node:path';
import type {SpectatorModel} from '../../shared/full';
import type {GameState, Tick} from '../../shared/game';
import type {GameHistory} from '../../shared/history';
import type {NarrationLine, NarrationReport, NarratorMode} from '../../shared/narrator';
import {detectCompanion, detectFull, newMemory, primeCompanion} from './detect';
import type {NarratorEvent, NarratorMemory} from './detect';
import {buildMessages} from './prompt';
import {Scheduler} from './schedule';
import {audioDurationMs, audioExt, configFromEnv, geminiCostUsd, geminiEstimateUsd, humeCostUsd, paidReady, probeGemini, probeHume, probeLlm,
  speak, speakGemini, speakHume, SpeechError, TTS_ACCOUNT, TTS_NAMES, writeLine} from './services';
import type {NarratorConfig, PaidTts, Reach, TtsProvider} from './services';
import {validateReply} from './validate';

/** A line not shown on the TV within this long after it was made is not worth showing. */
export const LINE_TTL_MS = 30_000;
export const GAME_END_TTL_MS = 120_000;
const KEEP_AUDIO_MS = 2 * 60 * 60 * 1000;
const KEEP_AUDIO_FILES = 60;
const LOG_EVERY_MS = 10 * 60 * 1000;
const GAME_END_REPORT_MS = 60_000;
/** How long a paid voice is left alone after it said its account is out of credits. */
export const CREDIT_BACKOFF_MS = 10 * 60 * 1000;

/** Paid speech for one game: what was spent, and whether the budget is used up. */
export type SpeechLedger = {
  gameId: string;
  /** lines, characters and estimated dollars spent on paid voices (all of them together) */
  paidLines: number;
  paidChars: number;
  paidUsd: number;
  /** paid lines per voice */
  byProvider: Partial<Record<PaidTts, number>>;
  fallbackLines: number;
  failedLines: number;
  /** why lines went to the fallback, counted */
  fallbacks: Record<string, number>;
  overBudget: boolean;
  reported: boolean;
};

/** What mission control has been doing, for /api/health and the TV options' status line. */
export type NarratorActivity = {
  linesSent: number;
  lastLineAt: number | null;
  lastLineId: string | null;
  /** the latest failure of any kind (LLM, speech, rejected lines), logged or not */
  lastError: {kind: string; message: string; at: number} | null;
  llm: {okAt: number | null; failAt: number | null; error: string | null};
  speech: {okAt: number | null; provider: TtsProvider | null; failAt: number | null; error: string | null};
  /** each paid voice's own record: its last success and failure, and an out-of-credits reply with its back-off */
  paid: Record<PaidTts, PaidState>;
  /** what the TVs reported back about the lines (see NarrationReport) */
  tv: {reports: number; shown: number; spoken: number; notShown: number; lastShownAt: number | null; lastSpokeAt: number | null;
    lastDropReason: string | null; lastDropAt: number | null};
};

export type PaidState = {okAt: number | null; failAt: number | null; error: string | null;
  /** the last out-of-credits reply; cleared by the next line that voice speaks */
  credits: {at: number; message: string} | null;
  /** no requests to this voice before this time */
  backoffUntil: number};

/** How long a reachability probe's answer is reused. */
const PROBE_TTL_MS = 30_000;

type Speech = {audio: Buffer; ms: number; provider: TtsProvider; ttsMs: number};
/** What speaking one line came to: the audio (null = text only), why the paid voices were not used (if they were
 *  not), and how long the paid attempts took. */
type Voiced = {speech: Speech | null; fallback?: string; paidMs?: number};

export type NarratorDeps = {
  mode: () => NarratorMode;
  /** send a finished line to TV sockets */
  toTv: (line: NarrationLine) => void;
  /** player names at the table right now */
  players: () => string[];
  corporations: () => string[];
  dataDir: string;
  config?: NarratorConfig;
  now?: () => number;
  /** optional QA log (JSON lines) */
  logPath?: string;
  pumpMs?: number;
};

export class Narrator {
  readonly cfg: NarratorConfig;
  readonly audioDir: string;
  private mem: NarratorMemory | null = null;
  private scheduler = new Scheduler();
  private recent: string[] = [];
  private lastLog = new Map<string, number>();
  private timer: NodeJS.Timeout | null = null;
  private now: () => number;
  private seq = 0;
  private ledger: SpeechLedger = newLedger('');
  private act: NarratorActivity = newActivity();
  /** lines sent and still expecting reports: id -> whether it carried audio */
  private sentLines = new Map<string, boolean>();
  private reported = new Set<string>();
  private probes = new Map<string, {at: number; p: Promise<Reach>}>();

  constructor(private deps: NarratorDeps) {
    this.cfg = deps.config ?? configFromEnv();
    this.now = deps.now ?? Date.now;
    this.audioDir = path.join(deps.dataDir, 'narration');
    fs.mkdirSync(this.audioDir, {recursive: true});
    if (deps.pumpMs !== 0) {
      this.timer = setInterval(() => void this.pump(), deps.pumpMs ?? 1000);
      this.timer.unref();
    }
  }

  stop() { if (this.timer) clearInterval(this.timer); }

  get activity(): Readonly<NarratorActivity> { return this.act; }

  /**
   * A TV says what became of a line. Lines that never showed, and voice lines that stayed silent, are logged with the
   * TV's reason (the TV knows which stage flag held them back, or that its sound was locked).
   */
  tvReport(r: NarrationReport) {
    if (!r || typeof r.id !== 'string' || !this.sentLines.has(r.id)) return;
    const now = this.now();
    const t = this.act.tv;
    t.reports++;
    const first = !this.reported.has(r.id);
    this.reported.add(r.id);
    if (r.shown) { if (first) t.shown++; t.lastShownAt = now; }
    if (r.spoke) { t.spoken++; t.lastSpokeAt = now; }
    const voiced = this.sentLines.get(r.id);
    const reason = typeof r.reason === 'string' ? r.reason.slice(0, 120) : undefined;
    if (!r.shown || (voiced && !r.spoke)) {
      if (!r.shown && first) t.notShown++;
      t.lastDropReason = `${r.shown ? 'not spoken' : 'not shown'}${reason ? `: ${reason}` : ''}`;
      t.lastDropAt = now;
      console.info(`mission control: line ${r.id} ${r.shown ? 'shown but not spoken' : 'not shown'} on a TV${reason ? ` (${reason})` : ''}`);
    } else if (reason) {
      // shown and spoken, but something was off (a stage flag busy past the cap, a voice volume of 0)
      console.info(`mission control: line ${r.id} on a TV: ${reason}`);
    }
    this.qaRaw({result: 'tv-report', ...r, reason});
  }

  /**
   * Mission control's health for /api/health: whether the LLM (and Hume, when it is the voice) answers now, and what
   * happened lately. Probes are cached for 30 s and never block a line.
   */
  async health(): Promise<Record<string, unknown>> {
    const order = this.cfg.ttsOrder.filter((p) => paidReady(this.cfg, p));
    const [llm, ...probes] = await Promise.all([
      this.probe('llm', () => probeLlm(this.cfg)),
      ...order.map((p) => this.probe(p, () => (p === 'gemini' ? probeGemini(this.cfg) : probeHume(this.cfg)))),
    ]);
    const a = this.act;
    const now = this.now();
    const ago = (t: number | null) => (t === null ? null : Math.round((now - t) / 1000));
    // A provider is fine only when its check answers AND its own last request did not fail (a Hume account without
    // credits still lists its voices) AND it has not said it is out of credits since its last line.
    const providers: Record<string, unknown> = {};
    let outOfCredits: {provider: PaidTts; account: string; message: string; agoS: number | null; backoffLeftS: number; instead: string} | null = null;
    const okNow: PaidTts[] = [];
    order.forEach((p, i) => {
      const r = probes[i] as Reach & {outOfCredits?: boolean};
      const st = a.paid[p];
      const credits = st.credits ?? (r.outOfCredits ? {at: now, message: r.error ?? `${TTS_ACCOUNT[p]} is out of credits`} : null);
      const failing = st.failAt !== null && (st.okAt === null || st.failAt > st.okAt);
      providers[p] = {reachable: r.reachable, ok: r.reachable && !credits && !failing, ...(r.error ? {error: r.error} : {}),
        lastOkAgoS: ago(st.okAt), ...(st.error ? {lastError: st.error, lastErrorAgoS: ago(st.failAt)} : {}),
        ...(credits ? {outOfCredits: true, backoffLeftS: Math.max(0, Math.round((st.backoffUntil - now) / 1000))} : {})};
      if (credits && !outOfCredits) outOfCredits = {provider: p, account: TTS_ACCOUNT[p], message: credits.message, agoS: ago(credits.at),
        backoffLeftS: Math.max(0, Math.round((st.backoffUntil - now) / 1000)), instead: ''};
      else if (!credits) okNow.push(p);
    });
    // what speaks while that account is empty: the next paid voice that still has credits, else the local server
    if (outOfCredits) (outOfCredits as {instead: string}).instead = okNow.length ? `using ${TTS_NAMES[okNow[0]]}` : this.cfg.ttsUrl ? 'using the backup voice' : 'text only';
    const speechError = outOfCredits ? (outOfCredits as {message: string}).message : a.speech.error;
    return {
      mode: this.deps.mode(),
      llm: {reachable: llm.reachable, ...(llm.error ? {error: llm.error} : {}), model: this.cfg.llmModel, lastOkAgoS: ago(a.llm.okAt),
        ...(a.llm.error ? {lastError: a.llm.error, lastErrorAgoS: ago(a.llm.failAt)} : {})},
      speech: {provider: order[0] ?? (this.cfg.ttsUrl ? 'openai' : null), order: [...order, ...(this.cfg.ttsUrl ? ['openai'] : [])], providers,
        fallback: !!this.cfg.ttsUrl, outOfCredits, lastOkAgoS: ago(a.speech.okAt), lastProvider: a.speech.provider,
        ...(speechError ? {lastError: speechError, lastErrorAgoS: outOfCredits ? (outOfCredits as {agoS: number | null}).agoS : ago(a.speech.failAt)} : {})},
      linesSent: a.linesSent,
      lastLineAt: a.lastLineAt,
      lastLineAgoS: ago(a.lastLineAt),
      lastError: a.lastError ? {...a.lastError, agoS: ago(a.lastError.at)} : null,
      tv: {...a.tv, lastShownAgoS: ago(a.tv.lastShownAt), lastSpokeAgoS: ago(a.tv.lastSpokeAt)},
    };
  }

  private probe(key: string, run: () => Promise<Reach>): Promise<Reach> {
    const now = this.now();
    const hit = this.probes.get(key);
    if (hit && now - hit.at < PROBE_TTL_MS) return hit.p;
    const p = run().catch((e: Error): Reach => ({reachable: false, error: e.message}));
    this.probes.set(key, {at: now, p});
    return p;
  }

  /** This game's paid-speech totals so far. */
  get spend(): Readonly<SpeechLedger> { return this.ledger; }

  private memory(gameId: string, prime?: (m: NarratorMemory) => void): NarratorMemory {
    if (this.mem?.gameId !== gameId) {
      this.reportSpend();
      this.ledger = newLedger(gameId);
      this.mem = newMemory(gameId);
      prime?.(this.mem);
      this.scheduler.clear();
      this.recent = [];
    }
    return this.mem;
  }

  /** Companion mode: one committed command. */
  companion(before: GameState, tick: Tick, after: GameState, ticks: Tick[]) {
    const mem = this.memory(after.id, (m) => primeCompanion(m, before));
    const events = detectCompanion(mem, before, tick, after, ticks, this.now());
    this.offer(events);
  }

  /** Full mode: one observed engine model (prev is null on first sight). */
  full(gameId: string, prev: SpectatorModel | null, next: SpectatorModel, history: GameHistory | null) {
    const mem = this.memory(gameId);
    this.offer(detectFull(mem, prev, next, history, this.now()));
  }

  /**
   * An undo: moments still waiting may describe the move that was taken back, so they are dropped, and the undoer's
   * latest play or action is forgotten (it no longer explains anything). The next model is then learned as a fresh look.
   */
  undo(gameId: string, actor: string | null) {
    this.scheduler.clear();
    if (actor) this.memory(gameId).recent.delete(actor);
  }

  private offer(events: NarratorEvent[]) {
    if (this.deps.mode() === 'off') return;
    this.scheduler.offer(events);
    // The game's totals are logged after its last line; this covers a last line that never gets made.
    if (events.some((e) => e.kind === 'gameEnd')) setTimeout(() => this.reportSpend(), GAME_END_REPORT_MS).unref();
    if (events.length) void this.pump();
  }

  /** The table changed the setting. Turning it off forgets anything waiting. */
  modeChanged(mode: NarratorMode) {
    if (mode === 'off') this.scheduler.clear();
  }

  async pump(): Promise<void> {
    if (this.deps.mode() === 'off') { this.scheduler.clear(); return; }
    const e = this.scheduler.take(this.now());
    if (!e) return;
    let spoke = false;
    try {
      spoke = await this.produce(e);
    } catch (err) {
      this.warn('produce', `mission control: ${(err as Error).message}`);
    } finally {
      this.scheduler.done(this.now(), spoke);
      if (e.kind === 'gameEnd') this.reportSpend();
    }
  }

  /** Write, check, optionally speak, and send one line. Returns whether anything reached the TV. */
  private async produce(e: NarratorEvent): Promise<boolean> {
    const players = this.deps.players();
    const ctx = {players, cards: e.cards, facts: e.facts, corporations: this.deps.corporations(), avoid: e.avoid};
    const t0 = this.now();
    let text: string | null = null;
    let note = '';
    let noteSource: 'model' | 'default' = 'default';
    let reason: string | undefined;
    const attempts: Array<{line: string; ok: boolean; reason?: string}> = [];
    for (let attempt = 0; attempt < 2 && !text; attempt++) {
      let raw: string;
      try {
        raw = await writeLine(this.cfg, buildMessages(e, players, this.recent, reason));
        this.act.llm.okAt = this.now();
      } catch (err) {
        this.act.llm.failAt = this.now();
        this.act.llm.error = (err as Error).message;
        this.warn('llm', `mission control: the LLM did not answer (${(err as Error).message}); no line`);
        this.qa({event: e, attempts, result: 'llm-failed', error: (err as Error).message});
        return false;
      }
      const v = validateReply(raw, ctx, e.kind);
      attempts.push({line: raw, ok: v.ok, reason: v.ok ? undefined : v.reason});
      if (v.ok) { text = v.text; note = v.note; noteSource = v.noteSource; } else reason = v.reason;
    }
    const llmMs = this.now() - t0;
    if (!text) { this.note('rejected', `both attempts refused (${reason ?? 'invalid'})`); this.qa({event: e, attempts, result: 'rejected', llmMs}); return false; }
    // A setting change while the model was writing wins.
    const mode = this.deps.mode();
    if (mode === 'off') return false;

    const id = `n${this.now().toString(36)}${(++this.seq).toString(36)}`;
    // The game's last line may wait behind the whole end-of-game story, so it lives longer.
    const line: NarrationLine = {id, text, kind: e.kind, at: this.now(), ttlMs: e.kind === 'gameEnd' ? GAME_END_TTL_MS : LINE_TTL_MS};
    const voiced: Voiced | null = mode === 'voice' ? await this.voice(text, note) : null;
    const speech = voiced?.speech;
    if (speech) {
      const ext = audioExt(speech.audio);
      fs.writeFileSync(path.join(this.audioDir, `${id}.${ext}`), speech.audio);
      line.audioUrl = `/api/narration/${id}.${ext}`;
      line.audioMs = speech.ms;
      this.cleanAudio();
    }
    if (this.deps.mode() === 'off') return false;
    this.recent = [...this.recent.slice(-5), text];
    line.at = this.now();
    this.deps.toTv(line);
    this.act.linesSent++;
    this.act.lastLineAt = line.at;
    this.act.lastLineId = id;
    this.sentLines.set(id, !!line.audioUrl);
    if (this.sentLines.size > 200) { const old = this.sentLines.keys().next().value!; this.sentLines.delete(old); this.reported.delete(old); }
    if (speech) { this.act.speech.okAt = line.at; this.act.speech.provider = speech.provider; }
    this.qa({event: e, attempts, result: 'sent', llmMs, text, act: note, actSource: noteSource,
      ...(mode === 'voice' ? {tts: speech?.provider ?? 'none', ttsMs: speech?.ttsMs, paidMs: voiced?.paidMs, fallback: voiced?.fallback,
        audioMs: line.audioMs, gameUsd: round4(this.ledger.paidUsd)} : {})});
    return true;
  }

  /**
   * Speak a line: the paid voices in order (while the game's budget lasts and the voice is not backed off), then the
   * local voice when they fail, time out, sound wrong for the line's length, are out of credits or over budget.
   * Null speech means text only.
   */
  private async voice(text: string, note: string): Promise<Voiced> {
    const cfg = this.cfg;
    const reasons: string[] = [];
    let paidMs: number | undefined;
    const fail = (reason: string) => { reasons.push(reason); this.ledger.fallbacks[reason] = (this.ledger.fallbacks[reason] ?? 0) + 1; };
    for (const p of cfg.ttsOrder) {
      if (!paidReady(cfg, p)) { fail(p === 'hume' ? 'no-key' : `${p}-no-key`); continue; }
      const st = this.act.paid[p];
      if (this.now() < st.backoffUntil) { fail(`${p}-no-credits`); continue; }
      const estimate = p === 'gemini' ? geminiEstimateUsd(cfg, text) : humeCostUsd(cfg, text);
      if (this.ledger.overBudget || this.ledger.paidUsd + estimate > cfg.budgetUsd) {
        if (!this.ledger.overBudget) {
          this.ledger.overBudget = true;
          console.info(`mission control: speech budget $${cfg.budgetUsd.toFixed(2)} reached for game ${this.ledger.gameId} ($${this.ledger.paidUsd.toFixed(4)} spent); local voice for the rest of the game`);
        }
        fail('budget');
        break;
      }
      const t = this.now();
      try {
        const audio = p === 'gemini' ? await speakGemini(cfg, text, note) : await speakHume(cfg, text, note);
        const ms = this.now() - t;
        paidMs = (paidMs ?? 0) + ms;
        const dur = audioDurationMs(audio);
        this.charge(p, text, p === 'gemini' && dur !== null ? geminiCostUsd(cfg, dur) : estimate);
        st.okAt = this.now();
        st.credits = null;
        const fits = fitsLine(audio, text);
        if (fits !== null) return {speech: {audio, ms: fits, provider: p, ttsMs: ms}, paidMs, fallback: reasons.join(',') || undefined};
        fail(`${p}-length`);
      } catch (err) {
        paidMs = (paidMs ?? 0) + (this.now() - t);
        const msg = (err as Error).message;
        const timedOut = /timeout|aborted/i.test(msg) || (err as Error).name === 'TimeoutError';
        // A request that ran out of time may still be billed; count it so the budget errs on the safe side.
        if (timedOut) this.charge(p, text, estimate);
        st.failAt = this.now();
        st.error = msg.slice(0, 200);
        if (err instanceof SpeechError && err.quota) {
          st.backoffUntil = this.now() + CREDIT_BACKOFF_MS;
          const said = `${TTS_ACCOUNT[p]} is out of credits (${msg.slice(0, 120)}); ${TTS_NAMES[p]} rests for 10 min`;
          st.credits = {at: this.now(), message: `${TTS_ACCOUNT[p]} is out of credits: ${msg.slice(0, 160)}`};
          fail(`${p}-no-credits`);
          this.warn(p, `mission control: ${said}`);
          // the health and status line name the account; the speech error keeps the provider's own words
          this.act.speech.error = st.credits.message;
        } else {
          fail(`${p}-${timedOut ? 'timeout' : 'error'}`);
          this.warn(p, `mission control: ${TTS_NAMES[p]} speech failed (${msg}); trying the next voice`);
        }
      }
    }
    const fallback = reasons.join(',') || undefined;
    if (!cfg.ttsUrl && cfg.ttsOrder.length) { this.ledger.failedLines++; return {speech: null, fallback, paidMs}; }
    const t = this.now();
    try {
      const audio = await speak(cfg, text);
      const ttsMs = this.now() - t;
      const ms = fitsLine(audio, text);
      if (ms === null) {
        this.warn('tts-length', 'mission control: speech length does not fit the line; text only');
        this.ledger.failedLines++;
        return {speech: null, fallback, paidMs};
      }
      if (fallback) this.ledger.fallbackLines++;
      return {speech: {audio, ms, provider: 'openai', ttsMs}, fallback, paidMs};
    } catch (err) {
      this.warn('tts', `mission control: speech failed (${(err as Error).message}); text only`);
      this.ledger.failedLines++;
      return {speech: null, fallback, paidMs};
    }
  }

  private charge(p: PaidTts, text: string, usd: number) {
    this.ledger.paidLines++;
    this.ledger.paidChars += text.length;
    this.ledger.paidUsd += usd;
    this.ledger.byProvider[p] = (this.ledger.byProvider[p] ?? 0) + 1;
  }

  /** Log a game's paid-speech totals once (at the game's last line, or when the next game starts). */
  private reportSpend() {
    const l = this.ledger;
    if (l.reported || !l.gameId || (!l.paidLines && !l.fallbackLines && !l.failedLines)) return;
    l.reported = true;
    const paid = Object.entries(l.byProvider).map(([p, n]) => `${n} ${TTS_NAMES[p as PaidTts]}`).join(', ') || '0 paid';
    console.info(`mission control: game ${l.gameId} speech: ${paid} lines, ${l.paidChars} characters, ` +
      `$${l.paidUsd.toFixed(4)}; ${l.fallbackLines} local-voice fallbacks${Object.keys(l.fallbacks).length ? ` (${Object.entries(l.fallbacks).map(([k, v]) => `${k} ${v}`).join(', ')})` : ''}; ${l.failedLines} text only`);
    this.qaRaw({result: 'speech-total', gameId: l.gameId, order: this.cfg.ttsOrder, budgetUsd: this.cfg.budgetUsd,
      paidLines: l.paidLines, byProvider: l.byProvider, paidChars: l.paidChars, paidUsd: round4(l.paidUsd), fallbackLines: l.fallbackLines,
      fallbacks: l.fallbacks, failedLines: l.failedLines, overBudget: l.overBudget});
  }

  /** Where a line's audio lives, if the name is one of ours. */
  audioPath(file: string): string | null {
    if (!/^n[a-z0-9]+\.(mp3|wav)$/.test(file)) return null;
    const p = path.join(this.audioDir, file);
    return fs.existsSync(p) ? p : null;
  }

  private cleanAudio() {
    try {
      const files = fs.readdirSync(this.audioDir).filter((f) => /\.(mp3|wav)$/.test(f))
        .map((f) => ({f, t: fs.statSync(path.join(this.audioDir, f)).mtimeMs})).sort((a, b) => b.t - a.t);
      const cutoff = Date.now() - KEEP_AUDIO_MS;
      files.forEach((x, i) => { if (i >= KEEP_AUDIO_FILES || x.t < cutoff) fs.rmSync(path.join(this.audioDir, x.f), {force: true}); });
    } catch { /* cleaning is best effort */ }
  }

  /** Log a failure once per kind per ten minutes. */
  private warn(kind: string, message: string) {
    this.note(kind, message);
    if (kind === 'hume' || kind === 'gemini' || kind === 'tts' || kind === 'tts-length') { this.act.speech.failAt = this.now(); this.act.speech.error = message.replace(/^mission control: /, ''); }
    const last = this.lastLog.get(kind) ?? -Infinity;
    if (Date.now() - last < LOG_EVERY_MS) return;
    this.lastLog.set(kind, Date.now());
    console.warn(message);
  }

  /** Remember the latest failure for /api/health (logging stays rate-limited in warn). */
  private note(kind: string, message: string) {
    this.act.lastError = {kind, message: message.replace(/^mission control: /, '').slice(0, 200), at: this.now()};
  }

  private qaRaw(entry: Record<string, unknown>) {
    if (!this.deps.logPath) return;
    try {
      fs.appendFileSync(this.deps.logPath, JSON.stringify({...entry, at: new Date().toISOString()}) + '\n');
    } catch { /* QA logging is optional */ }
  }

  private qa(entry: Record<string, unknown>) {
    if (!this.deps.logPath) return;
    try {
      const e = entry.event as NarratorEvent;
      fs.appendFileSync(this.deps.logPath, JSON.stringify({...entry, event: {kind: e.kind, key: e.key, priority: e.priority, facts: e.facts, waitedMs: Date.now() - e.at}, at: new Date().toISOString()}) + '\n');
    } catch { /* QA logging is optional */ }
  }
}

function newActivity(): NarratorActivity {
  return {linesSent: 0, lastLineAt: null, lastLineId: null, lastError: null,
    llm: {okAt: null, failAt: null, error: null}, speech: {okAt: null, provider: null, failAt: null, error: null},
    paid: {gemini: newPaidState(), hume: newPaidState()},
    tv: {reports: 0, shown: 0, spoken: 0, notShown: 0, lastShownAt: null, lastSpokeAt: null, lastDropReason: null, lastDropAt: null}};
}

function newPaidState(): PaidState {
  return {okAt: null, failAt: null, error: null, credits: null, backoffUntil: 0};
}

function newLedger(gameId: string): SpeechLedger {
  return {gameId, paidLines: 0, paidChars: 0, paidUsd: 0, byProvider: {}, fallbackLines: 0, failedLines: 0, fallbacks: {}, overBudget: false, reported: false};
}

const round4 = (x: number) => Math.round(x * 10_000) / 10_000;

/**
 * The audio's length in ms if it fits the line, else null. Either voice very occasionally runs on or
 * garbles; audio far off the text's length is not used.
 */
export function fitsLine(audio: Buffer, text: string): number | null {
  const ms = audioDurationMs(audio);
  const expected = text.length / 16 * 1000;
  if (ms === null || ms < expected * 0.4 || ms > Math.max(3000, expected * 2.5)) return null;
  return ms;
}
