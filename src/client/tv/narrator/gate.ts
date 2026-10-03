// Mission control on the TV: which line to show next, which lines waited too long, and whether a busy stage may
// still hold a line back. Pure functions, so the rules are tested without a browser.
import {STAGE_WAIT_MAX_MS, STORY_WAIT_MAX_MS} from '../../../shared/narrator';
import type {NarrationLine} from '../../../shared/narrator';

/** What can hold a caption back: each flag names one thing that has the screen. */
export type StageFlags = {cinema: boolean; production: boolean; moment: boolean; flick: boolean; story: boolean};

const GATE_NAMES: Record<keyof StageFlags, string> = {
  cinema: 'a cinematic', production: 'the production show', moment: 'a companion moment', flick: 'a flicked card', story: 'the end-of-game story',
};

/** The busy flags by name ('a cinematic + a flicked card'), or '' when the stage is free. */
export function gateNames(f: StageFlags): string {
  return (Object.keys(GATE_NAMES) as Array<keyof StageFlags>).filter((k) => f[k]).map((k) => GATE_NAMES[k]).join(' + ');
}

/**
 * May a busy stage still hold captions back? A stage flag is a courtesy (the caption lane never covers the board):
 * once the stage has been busy without a break for longer than the cap, captions show anyway, so one flag that never
 * clears cannot silence mission control for the rest of the game. The end-of-game story holds longer.
 */
export function stageHolds(busySince: number | null, now: number, story: boolean): boolean {
  if (busySince === null) return false;
  return now - busySince < (story ? STORY_WAIT_MAX_MS : STAGE_WAIT_MAX_MS);
}

/** The next line to show, and the lines that waited past their time (to be reported and skipped). */
export function pickLine(lines: NarrationLine[], done: ReadonlySet<string>, now: number, mountedAt: number):
  {next: NarrationLine | null; expired: NarrationLine[]} {
  const fresh = lines.filter((l) => !done.has(l.id) && l.at >= mountedAt - 500);
  const expired = fresh.filter((l) => now - l.at > l.ttlMs);
  const next = fresh.find((l) => now - l.at <= l.ttlMs) ?? null;
  return {next, expired};
}

/** Why a voice line stayed silent on this TV, or null when it can speak. */
export function silentReason(s: {muted: boolean; canSpeak: boolean}): string | null {
  if (s.muted) return 'TV sound is off';
  if (!s.canSpeak) return 'sound locked: no tap or key on this TV since it loaded';
  return null;
}
