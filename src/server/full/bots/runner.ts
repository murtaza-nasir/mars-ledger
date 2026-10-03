// The bot desk: answers the engine's prompts for every bot seat in the running full game, through the same bridge
// input the phones use. It keeps no state of its own that matters: the seats come from the game log (state.players
// with `bot`, linked to engine players by state.full), and each bot's question comes from the engine, so after a
// server restart the bots simply answer the question they are on.
//
// Pace: the table's bot speed (shared/bots.ts). Table pace, the default, takes about as long as a person: 6–15 s
// on the turn menu (longer with more options and later in the game), a short breath before a second action,
// 1.5–4 s for a follow-up inside a move and 2–5 s for a card pick; Slow is 1.5× that and Quick is fast
// (1–3 s on the turn menu). Time spent deciding (a judge's model call) counts toward the wait. Moves never land
// while the production show plays (moves in the action phase also wait for the TV's generation recap after
// it, so the table sees them), and none at all for the end-of-game scoring steps.
// Robustness: an answer the engine refuses is logged, its path is avoided, and the bot answers again with another
// option; when nothing it would choose is left it takes a safe default (pass, end turn, the first option). A bot
// that still cannot answer waits a few seconds and tries again; it never blocks the server.
import * as fs from 'node:fs';
import type {BotLevel, BotSpeed} from '../../../shared/bots';
import {DEFAULT_BOT_SPEED} from '../../../shared/bots';
import type {Color, InputResponse, PlayerInputModel, PlayerViewModel} from '../../../shared/full';
import {messageText} from '../../../shared/full';
import {decide, isTurnMenu, safeDefault} from './decide';
import {deadEndReason} from '../../../shared/deadend';
import type {Decision} from './decide';
import {JEV_USD_PER_M_INPUT, judgeDecide} from './judge/judge';
import {newMemory} from './judge/facts';
import type {JudgeMemory} from './judge/facts';
import type {Caller, JudgeConfig, JudgeOutcome} from './judge/judge';

export type BotSeat = {playerId: string; name: string; level: BotLevel; engineId: string; color: Color};
export type BotTable = {gameId: string; bots: BotSeat[]; speed?: BotSpeed};

export type BotLogEntry = {
  at: number; game: string; bot: string; name: string; level: BotLevel; generation: number; phase: string;
  prompt: string; type: string; choice?: string; path?: string; waitedMs?: number; thinkMs?: number;
  outcome: 'ok' | 'refused' | 'stuck' | 'default'; error?: string; attempt: number;
  /** the decision model's part, when a judge plays this seat (BOT_JUDGE) */
  judge?: {type: string; agreed: boolean; fallback?: string; ms: number; chosen?: string; tokens?: number};
};

type Memory = {sig: string; avoid: Set<string>; refused: number; stuckUntil: number};

export type BotDeskOptions = {
  player: (engineId: string) => Promise<PlayerViewModel>;
  table: () => BotTable | null;
  input: (playerId: string, response: InputResponse) => Promise<void>;
  /** Server time before which bots wait: the production show, and for moves the table watches (`acting`, the
   *  action phase) also the TV's generation recap after it. */
  holdUntil?: (acting: boolean) => number;
  /** Multiplies every wait (BOT_DELAY_SCALE; 0 for instant bots in tests). */
  delayScale?: number;
  rng?: () => number;
  tickMs?: number;
  log?: (e: BotLogEntry) => void;
  /** A bot's question that no answer can satisfy (the bridge tells the table). */
  onDeadEnd?: (playerId: string, model: PlayerViewModel) => void;
  /** Experimental (BOT_JUDGE): a decision model picks among Normal's options for the seats `seats` accepts
   *  (default: every Normal bot). Off when absent; Easy and Normal are unchanged. */
  judge?: {config: JudgeConfig; call: Caller; seats?: (bot: BotSeat) => boolean};
  /** The Jev level's judge (absent without a TypeSafe key: Jev seats then play as Normal). */
  jev?: {config: JudgeConfig; call: Caller};
  /** Most a Jev bot may spend on the model in one game (USD); past it the bot plays as Normal (BOT_JEV_BUDGET_USD). */
  jevBudgetUsd?: number;
};

/** Answers tried per question before the bot falls back to a safe default. */
const MAX_REFUSALS = 12;

/**
 * After a person took back their move and the bot moves after it, the bots wait: until that person moves again (most
 * this long, when it is their turn), or for a short grace when it is not their turn.
 */
export const BOT_HOLD_FOR_TURN_MS = 10 * 60_000;
export const BOT_HOLD_GRACE_MS = 6000;

export class BotDesk {
  private timers = new Map<string, {sig: string; t: NodeJS.Timeout; speed?: BotSpeed}>();
  private acting = new Set<string>();
  private memory = new Map<string, Memory>();
  /** Jev spend so far per game and bot (USD, from the reported input tokens). */
  private jevSpend = new Map<string, number>();
  /** What each judged bot has seen and done (judge/facts.ts), by game and seat. */
  private judgeMemory = new Map<string, JudgeMemory>();
  private ticking = false;
  private again = false;
  private interval: NodeJS.Timeout;
  /** Moves waiting out their pace after deciding; stop() releases them. */
  private sleepers = new Set<() => void>();
  private rng: () => number;
  private scale: number;
  /** No bot moves before this time (an undo through bot moves); release() ends it early. */
  private heldUntil = 0;
  private holdTimer: NodeJS.Timeout | null = null;
  stopped = false;

  constructor(private o: BotDeskOptions) {
    this.rng = o.rng ?? Math.random;
    this.scale = o.delayScale ?? 1;
    this.interval = setInterval(() => this.kick(), o.tickMs ?? 1000);
    this.interval.unref();
  }

  /** Look at every bot's question now (after any input, or when the table changes). */
  kick() {
    if (this.stopped) return;
    if (this.ticking) { this.again = true; return; }
    this.ticking = true;
    void this.tick().finally(() => {
      this.ticking = false;
      if (this.again) { this.again = false; this.kick(); }
    });
  }

  /** Hold every bot seat for `ms`: scheduled moves are dropped, and a move being decided is not sent. */
  hold(ms: number) {
    this.heldUntil = Date.now() + ms;
    for (const {t} of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    if (this.holdTimer) clearTimeout(this.holdTimer);
    this.holdTimer = setTimeout(() => { this.holdTimer = null; this.kick(); }, ms + 50);
    this.holdTimer.unref?.();
  }

  /** A person moved: the bots may play again. */
  release() {
    if (!this.heldUntil) return;
    this.heldUntil = 0;
    if (this.holdTimer) { clearTimeout(this.holdTimer); this.holdTimer = null; }
    this.kick();
  }

  /** Are the bots held after an undo? */
  get held(): boolean { return Date.now() < this.heldUntil; }

  stop() {
    this.stopped = true;
    if (this.holdTimer) clearTimeout(this.holdTimer);
    clearInterval(this.interval);
    for (const {t} of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    for (const wake of [...this.sleepers]) wake();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const wake = () => { clearTimeout(t); this.sleepers.delete(wake); resolve(); };
      const t = setTimeout(wake, Math.max(0, ms));
      this.sleepers.add(wake);
    });
  }

  /** Seats with a move scheduled or being made (for tests). */
  get busy(): number { return this.timers.size + this.acting.size; }

  private async tick() {
    const table = this.o.table();
    const live = new Set(table?.bots.map((b) => b.playerId) ?? []);
    // A game that ended, was abandoned or replaced: forget its scheduled moves.
    for (const [id, {t}] of this.timers) if (!live.has(id)) { clearTimeout(t); this.timers.delete(id); }
    for (const id of [...this.memory.keys()]) if (!live.has(id)) this.memory.delete(id);
    if (!table) return;
    if (this.held) {
      for (const {t} of this.timers.values()) clearTimeout(t);
      this.timers.clear();
      return;
    }
    await Promise.all(table.bots.map(async (bot) => {
      if (this.acting.has(bot.playerId)) return;
      let model: PlayerViewModel;
      try { model = await this.o.player(bot.engineId); } catch { return; }
      const w = model.waitingFor;
      const scheduled = this.timers.get(bot.playerId);
      if (!w || w.optional) {
        if (scheduled) { clearTimeout(scheduled.t); this.timers.delete(bot.playerId); }
        return;
      }
      const sig = signature(table.gameId, model);
      // a scheduled move keeps its time unless the table changed the bot speed meanwhile
      if (scheduled?.sig === sig && scheduled.speed === table.speed) return;
      // No answer exists (the engine dealt an empty draft hand): report it once and leave it alone.
      if (deadEndReason(w)) {
        if (this.memory.get(bot.playerId)?.sig !== sig) {
          this.recall(bot.playerId, sig);
          this.write(bot, table.gameId, model, w, {outcome: 'stuck', error: `no answer exists: ${deadEndReason(w)}`, attempt: 0});
          try { this.o.onDeadEnd?.(bot.playerId, model); } catch { /* reporting never stops a bot */ }
        }
        return;
      }
      if (scheduled) { clearTimeout(scheduled.t); this.timers.delete(bot.playerId); }
      const mem = this.recall(bot.playerId, sig);
      const now = Date.now();
      if (mem.stuckUntil > now) return;
      const base = this.waitFor(w, model, table.speed);
      // The end-of-game scoring never waits, not even for a show.
      const scoring = base === 0 && this.endgame(w, model);
      const hold = scoring ? 0 : (this.o.holdUntil?.(model.game.phase === 'action') ?? 0) - now;
      const wait = Math.max(base, hold);
      // The bot starts deciding once any show is over and answers when its pace is up: time spent deciding (a
      // judge's model call) is part of the wait, not added to it.
      const t = setTimeout(() => {
        this.timers.delete(bot.playerId);
        void this.act(table.gameId, bot, sig, wait, now + wait, scoring);
      }, Math.max(0, hold));
      this.timers.set(bot.playerId, {sig, t, speed: table.speed});
    }));
  }

  private recall(id: string, sig: string): Memory {
    let mem = this.memory.get(id);
    if (!mem || mem.sig !== sig) {
      mem = {sig, avoid: new Set(), refused: 0, stuckUntil: 0};
      this.memory.set(id, mem);
    }
    return mem;
  }

  /** The end-of-game scoring steps (final greeneries after the last production). */
  private endgame(w: PlayerInputModel, model: PlayerViewModel): boolean {
    return model.game.phase === 'end' || messageText(w.title).toLowerCase().includes('final greenery');
  }

  /** How long a person would take over this question (ms), at the table's bot speed. */
  waitFor(w: PlayerInputModel, model: PlayerViewModel, speed: BotSpeed = DEFAULT_BOT_SPEED): number {
    // The end-of-game scoring steps never wait.
    if (this.endgame(w, model)) return 0;
    const between = (a: number, b: number) => (a + this.rng() * (b - a)) * this.scale;
    const picking = w.type === 'initialCards' || model.game.phase === 'research' || model.game.phase === 'drafting';
    if (speed === 'quick') {
      if (isTurnMenu(w)) return between(1000, 3000);
      // card picks in research and drafting happen out of sight
      if (picking) return between(400, 1200);
      // a follow-up inside a move (where to put the tile, whom to target, how to pay)
      return between(600, 1400);
    }
    const k = speed === 'slow' ? 1.5 : 1;
    if (isTurnMenu(w)) {
      // the second action of a turn comes after a short breath
      if (/^take your next action/i.test(messageText(w.title))) return between(2500 * k, 5000 * k);
      // a fuller menu and a later generation take longer: 6–9 s on a bare early menu, 10–15 s on a busy late one
      const options = (w as {options?: unknown[]}).options?.length ?? 0;
      const c = 0.6 * clamp01((options - 3) / 7) + 0.4 * clamp01((model.game.generation - 1) / 9);
      return between((6000 + 4000 * c) * k, (9000 + 6000 * c) * k);
    }
    // the table waits on research and draft picks, so these stay short
    if (picking) return between(2000 * k, 5000 * k);
    return between(1500 * k, 4000 * k);
  }

  private async act(gameId: string, bot: BotSeat, sig: string, waited: number, due = 0, scoring = false) {
    if (this.stopped || this.acting.has(bot.playerId)) return;
    this.acting.add(bot.playerId);
    try {
      for (let attempt = 0; attempt < MAX_REFUSALS + 6; attempt++) {
        const table = this.o.table();
        if (!table || table.gameId !== gameId || !table.bots.some((b) => b.playerId === bot.playerId)) return;
        let model: PlayerViewModel;
        try { model = await this.o.player(bot.engineId); } catch { return; }
        const w = model.waitingFor;
        if (!w || w.optional || signature(gameId, model) !== sig) return; // moved on; the next look reschedules
        const mem = this.recall(bot.playerId, sig);
        const t0 = Date.now();
        let d: Decision | null = null;
        let outcome: BotLogEntry['outcome'] = 'ok';
        let judged: JudgeOutcome | null = null;
        try {
          const spendKey = `${gameId}:${bot.playerId}`;
          const jevOk = bot.level !== 'jev' || (this.jevSpend.get(spendKey) ?? 0) < (this.o.jevBudgetUsd ?? 0.1);
          const judge = bot.level === 'jev' ? (jevOk ? this.o.jev : undefined) : this.o.judge;
          if (judge && mem.refused < MAX_REFUSALS && (bot.level === 'jev' || (this.o.judge?.seats ? this.o.judge.seats(bot) : bot.level === 'normal'))) {
            let jm = this.judgeMemory.get(spendKey);
            if (!jm) {
              // one game at a time: forget other games' memories
              for (const k of this.judgeMemory.keys()) if (!k.startsWith(`${gameId}:`)) this.judgeMemory.delete(k);
              this.judgeMemory.set(spendKey, jm = newMemory());
            }
            judged = await judgeDecide(w, model, {level: bot.level, rng: this.rng, avoid: mem.avoid}, judge.config, judge.call, this.rng, jm);
            if (bot.level === 'jev' && judged?.inputTokens) {
              const spent = (this.jevSpend.get(spendKey) ?? 0) + judged.inputTokens * JEV_USD_PER_M_INPUT / 1e6;
              this.jevSpend.set(spendKey, spent);
              if (spent >= (this.o.jevBudgetUsd ?? 0.1)) console.warn(`bots: ${bot.name} reached the Jev budget for game ${gameId} ($${spent.toFixed(3)}); it plays as Normal from here`);
            }
            // The model took time: answer only if the engine still asks the same question.
            const now = await this.o.player(bot.engineId).catch(() => null);
            if (!now || signature(gameId, now) !== sig) return;
            d = judged?.decision ?? null;
          } else {
            d = mem.refused < MAX_REFUSALS ? decide(w, model, {level: bot.level, rng: this.rng, avoid: mem.avoid}) : null;
          }
        } catch (e) {
          this.write(bot, gameId, model, w, {outcome: 'refused', error: `decision failed: ${(e as Error).message}`, attempt});
        }
        if (!d) { d = safeDefault(w, mem.avoid); outcome = 'default'; }
        if (!d) {
          mem.stuckUntil = Date.now() + 5000;
          this.write(bot, gameId, model, w, {outcome: 'stuck', attempt});
          return;
        }
        const thinkMs = Date.now() - t0;
        // Wait out the rest of the pace (deciding took part of it), and any show that started meanwhile.
        let slept = false;
        for (;;) {
          if (scoring) break;
          const until = Math.max(due, this.o.holdUntil?.(model.game.phase === 'action') ?? 0);
          if (Date.now() >= until) break;
          await this.sleep(until - Date.now());
          slept = true;
          if (this.stopped) return;
        }
        due = 0;
        if (slept) {
          const again = this.o.table();
          if (!again || again.gameId !== gameId || !again.bots.some((b) => b.playerId === bot.playerId)) return;
          const now = await this.o.player(bot.engineId).catch(() => null);
          if (!now || signature(gameId, now) !== sig) return;
        }
        // an undo through bot moves came in while this bot was deciding: it waits for the person's next move
        if (this.held) return;
        try {
          await this.o.input(bot.playerId, d.response);
          this.write(bot, gameId, model, w, {outcome, choice: d.why, path: d.path, waitedMs: Math.round(waited), thinkMs, attempt,
            ...(judged ? {judge: {type: judged.type, agreed: judged.agreed, fallback: judged.fallback, ms: judged.ms, chosen: judged.chosen, tokens: judged.inputTokens}} : {})});
          return;
        } catch (e) {
          mem.avoid.add(d.path);
          mem.refused++;
          this.write(bot, gameId, model, w, {outcome: 'refused', choice: d.why, path: d.path, error: (e as Error).message, attempt});
          waited = 0;
        }
      }
      // Still refused after every attempt: look again shortly (the engine's question may change).
      const mem = this.memory.get(bot.playerId);
      if (mem) mem.stuckUntil = Date.now() + 5000;
    } finally {
      this.acting.delete(bot.playerId);
      this.kick();
    }
  }

  private write(bot: BotSeat, gameId: string, model: PlayerViewModel, w: PlayerInputModel, e: Partial<BotLogEntry> & Pick<BotLogEntry, 'outcome' | 'attempt'>) {
    const entry: BotLogEntry = {at: Date.now(), game: gameId, bot: bot.playerId, name: bot.name, level: bot.level,
      generation: model.game.generation, phase: model.game.phase, prompt: messageText(w.title), type: w.type, ...e};
    try { this.o.log?.(entry); } catch { /* logging never stops a bot */ }
  }
}

function clamp01(x: number): number { return Math.min(1, Math.max(0, x)); }

function signature(gameId: string, model: PlayerViewModel): string {
  const w = model.waitingFor;
  return `${gameId}:${model.game.gameAge}:${model.game.undoCount}:${hash(JSON.stringify(w ?? null))}:${model.cardsInHand.length}:${model.draftedCards?.length ?? 0}`;
}

function hash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

/** Console lines (and JSON lines to BOT_LOG when set) for every bot decision. */
export function botLogger(path = process.env.BOT_LOG): (e: BotLogEntry) => void {
  return (e) => {
    const who = `${e.name} (${e.level}) gen ${e.generation}`;
    if (e.outcome === 'ok' || e.outcome === 'default') console.log(`bot: ${who}: ${e.choice}${e.outcome === 'default' ? ' (safe default)' : ''} [waited ${e.waitedMs ?? 0} ms]`);
    else if (e.outcome === 'refused') console.log(`bot: ${who}: the engine refused "${e.choice ?? '?'}" on "${e.prompt}" (${e.error}); trying another option`);
    else console.log(`bot: ${who}: no answer for "${e.prompt}" (${e.type}); looking again in 5 s`);
    if (path) { try { fs.appendFileSync(path, JSON.stringify(e) + '\n'); } catch { /* best effort */ } }
  };
}
