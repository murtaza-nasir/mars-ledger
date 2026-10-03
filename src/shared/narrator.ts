// Mission control: short lines about notable moments, shown on the TV and optionally spoken there.
// The setting is table-wide and lives in the game state (a command in the log); the lines themselves
// are generated on the server and sent to TV sockets only.

export const NARRATOR_MODES = ['off', 'text', 'voice'] as const;
/** off: nothing. text: captions on the TV. voice: captions plus speech on the TV. */
export type NarratorMode = typeof NARRATOR_MODES[number];

export const NARRATOR_LABEL: Record<NarratorMode, string> = {off: 'Off', text: 'Text', voice: 'Text + voice'};

export function isNarratorMode(x: unknown): x is NarratorMode {
  return typeof x === 'string' && (NARRATOR_MODES as readonly string[]).includes(x);
}

export type NarrationLine = {
  id: string;
  text: string;
  /** what the line is about, for the caption's small label and for QA logs */
  kind: string;
  /** served by our server; present only when the table chose voice and speech succeeded */
  audioUrl?: string;
  audioMs?: number;
  /** server time the line was made; the TV drops lines that wait too long to be shown */
  at: number;
  /** how long after `at` the line is still worth showing */
  ttlMs: number;
};

/** Reading time for a caption: about 60 ms per character, never less than 4 s. */
export function readingMs(text: string): number {
  return Math.max(4000, text.length * 60);
}

/**
 * What became of one line on a TV, sent back to the server so the server log and /api/health can say whether
 * mission control actually reached the table (a line can be made and sent, yet never shown or heard).
 */
export type NarrationReport = {
  id: string;
  /** the caption appeared */
  shown: boolean;
  /** the voice played (false in text mode or when it could not) */
  spoke: boolean;
  /** why it was not shown or not spoken: 'expired behind cinema', 'sound locked', 'muted', 'audio failed', ... */
  reason?: string;
};

/** The longest a waiting line holds back for a busy stage flag before it shows anyway (a stuck flag must not mute
 *  mission control for the rest of the game). The end-of-game story's chapters may hold it for longer. */
export const STAGE_WAIT_MAX_MS = 15_000;
export const STORY_WAIT_MAX_MS = 60_000;

/** One readable status line for mission control, from the server's narrator health and this TV's sound state. */
export type NarratorStatusInput = {
  health: {mode?: string; llm?: {reachable: boolean | null; error?: string}; lastLineAt?: number | null;
    /** a paid voice's account out of credits (Hume's E0300, OpenRouter's 402), and whether a backup voice exists */
    speech?: {outOfCredits?: {account: string; instead?: string} | null; fallback?: boolean};
    tv?: {lastShownAt?: number | null; lastDropReason?: string | null}} | null;
  now: number;
  voiceLocked: boolean;
  muted: boolean;
};

export function narratorStatus(s: NarratorStatusInput): string | null {
  const h = s.health;
  if (!h) return null;
  if (!h.mode || h.mode === 'off') return 'Mission control: off for this table';
  if (h.llm?.reachable === false) return 'Mission control: can’t reach the language model';
  const ago = (t: number) => {
    const m = Math.round((s.now - t) / 60_000);
    return m < 1 ? 'just now' : m === 1 ? '1 min ago' : m < 90 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
  };
  const broke = h.mode === 'voice' ? h.speech?.outOfCredits : null;
  if (broke) return `Mission control: ${broke.account} is out of credits, ${broke.instead ?? (h.speech?.fallback ? 'using the backup voice' : 'text only')}`;
  const voice = h.mode === 'voice' ? (s.muted ? '; voice muted on this TV' : s.voiceLocked ? '; voice waits for a tap or key on this TV' : '') : '';
  if (!h.lastLineAt) return `Mission control: no lines yet${voice}`;
  return `Mission control: last line ${ago(h.lastLineAt)}${voice}`;
}
