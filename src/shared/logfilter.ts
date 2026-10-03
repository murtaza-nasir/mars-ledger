// Engine log lines that mean nothing to players. The engine logs its internal game id (and the id a game was
// cloned from) when a game ends; those reached the TV ticker, the phone log and the away summary.
import type {LogLine} from './full';

const HIDDEN = [/^This game id was \$\{0\}/, /^This game was a clone from game \$\{0\}/];

export function isHiddenLogLine(l: Pick<LogLine, 'message'>): boolean {
  return HIDDEN.some((re) => re.test(l.message));
}

export function visibleLogLines<T extends Pick<LogLine, 'message'>>(lines: T[]): T[] {
  return lines.filter((l) => !isHiddenLogLine(l));
}
