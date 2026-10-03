// The TV radio's relay: phones press the remote, the TV plays and reports what is on. Nothing is stored;
// the server only checks, rate-limits and passes messages on, and keeps the TV's latest report for phones
// that open their menu later.
import {ReactionLimiter} from '../shared/reactions';
import {isRadioAction, isSwitchAction, RADIO_PLAYER_LIMIT, RADIO_PLAYER_WINDOW_MS, RADIO_TABLE_LIMIT, RADIO_TABLE_WINDOW_MS} from '../shared/radio';
import type {RadioAction, RadioNow} from '../shared/radio';
import type {GameState} from '../shared/game';

export type RadioVerdict = {ok: true; action: RadioAction; from: string} | {ok: false; error: string};

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');

export class RadioDesk {
  private players = new ReactionLimiter(RADIO_PLAYER_LIMIT, RADIO_PLAYER_WINDOW_MS);
  private table = new ReactionLimiter(RADIO_TABLE_LIMIT, RADIO_TABLE_WINDOW_MS);
  /** server log lines: at most 20 a minute, so a broken playlist cannot flood the log */
  private logs = new ReactionLimiter(20, 60_000);
  /** what the TV last reported, and which socket reported it (cleared when that TV goes away) */
  now: RadioNow | null = null;
  reporter: unknown = null;

  /**
   * A phone's remote press: only a seated player, only as itself. The switch (on/off) needs a TV at the table;
   * the transport needs a TV radio that is on. `tvs`: TV sockets connected now.
   */
  judge(state: GameState, speaker: string | null, msg: {playerId: unknown; action: unknown}, now: number, tvs = 1): RadioVerdict {
    const p = state.players.find((x) => x.id === msg.playerId);
    if (!p) return {ok: false, error: 'Only players at the table can use the radio'};
    if (speaker !== null && speaker !== p.id) return {ok: false, error: 'A phone can only use the radio as its own player'};
    if (!isRadioAction(msg.action)) return {ok: false, error: 'Unknown radio button'};
    if (isSwitchAction(msg.action) ? tvs < 1 : !this.now?.on) return {ok: false, error: tvs < 1 ? 'No TV is connected' : 'The radio is off on the TV'};
    const mine = this.players.cooldown(p.id, now);
    const all = this.table.cooldown('table', now);
    const wait = Math.max(mine, all);
    if (wait > 0) return {ok: false, error: `Easy on the radio: try again in ${Math.ceil(wait / 1000)} s`};
    this.players.take(p.id, now);
    this.table.take('table', now);
    return {ok: true, action: msg.action, from: p.name};
  }

  /** The TV's report, cleaned; returns whether it changed. */
  report(raw: unknown, from: unknown): boolean {
    const o = (raw && typeof raw === 'object' ? raw : null) as Partial<RadioNow> | null;
    const next: RadioNow | null = o ? {
      enabled: !!o.enabled || !!o.on, on: !!o.on, playing: !!o.playing, videoId: typeof o.videoId === 'string' ? o.videoId.slice(0, 20) : null,
      index: Number.isInteger(o.index) ? Math.max(0, Number(o.index)) : 0,
      title: str(o.title, 160), artist: str(o.artist, 120), game: typeof o.game === 'string' ? o.game.slice(0, 120) : null,
    } : null;
    // A second TV with its radio off does not silence the one that plays.
    if (!next?.on && this.now?.on && from !== this.reporter) return false;
    if (!next?.enabled && this.now?.enabled && from !== this.reporter) return false;
    this.reporter = next ? from : null;
    if (JSON.stringify(next) === JSON.stringify(this.now)) return false;
    this.now = next;
    return true;
  }

  /** A TV socket closed: forget its report. Returns whether the phones should hear the radio went away. */
  gone(socket: unknown): boolean {
    if (socket !== this.reporter || !this.now) return false;
    this.now = null;
    this.reporter = null;
    return true;
  }

  /** A line for the server log (an unplayable track skipped, the radio giving up), rate-limited. */
  logLine(raw: unknown, now: number): string | null {
    const text = str(raw, 200).replace(/[\r\n]+/g, ' ').trim();
    if (!text || !this.logs.take('log', now).ok) return null;
    return `radio: ${text}`;
  }
}
