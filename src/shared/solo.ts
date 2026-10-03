// Solo full games: one player against the engine's neutral player. The engine's own rules decide:
// the game always runs to its last generation (14, or 12 with Prelude), and the player wins only if Mars is
// terraformed by then. These helpers turn the engine's model into the facts the phone and TV show.
import type {GameModel} from './full';

export type SoloStatus = {
  generation: number;
  /** the generation the game ends after */
  last: number;
  /** generations still to play, this one included */
  left: number;
  /** global steps still needed to terraform Mars */
  steps: {temperature: number; oxygen: number; oceans: number; total: number};
  /** null while the game runs; won or lost once it has ended */
  result: 'won' | 'lost' | null;
};

type SoloGame = Pick<GameModel, 'generation' | 'phase' | 'temperature' | 'oxygenLevel' | 'oceans' | 'lastSoloGeneration' | 'isSoloModeWin' | 'gameOptions'>;

/** Null unless this is a solo game (exactly one player). */
export function soloStatus(players: number, g: SoloGame): SoloStatus | null {
  if (players !== 1) return null;
  const last = g.lastSoloGeneration ?? (g.gameOptions?.expansions?.prelude ? 12 : 14);
  const steps = {
    temperature: Math.max(0, Math.ceil((8 - g.temperature) / 2)),
    oxygen: Math.max(0, 14 - g.oxygenLevel),
    oceans: Math.max(0, 9 - g.oceans),
    total: 0,
  };
  steps.total = steps.temperature + steps.oxygen + steps.oceans;
  const ended = g.phase === 'end';
  return {generation: g.generation, last, left: Math.max(0, last - g.generation + 1), steps,
    result: ended ? ((g.isSoloModeWin ?? steps.total === 0) ? 'won' : 'lost') : null};
}

/** "3 temperature steps, 2 % oxygen and 1 ocean" (only the parts still missing). */
export function stepsText(s: SoloStatus['steps']): string {
  const parts: string[] = [];
  if (s.temperature) parts.push(`${s.temperature} temperature step${s.temperature === 1 ? '' : 's'}`);
  if (s.oxygen) parts.push(`${s.oxygen} % oxygen`);
  if (s.oceans) parts.push(`${s.oceans} ocean${s.oceans === 1 ? '' : 's'}`);
  if (parts.length < 2) return parts[0] ?? 'nothing';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** The headline and one line under it for the end of a solo game. */
export function soloVerdict(s: SoloStatus): {title: string; line: string} {
  if (s.result === 'won') return {title: 'Mars is terraformed', line: `You won the solo game within the ${s.last}-generation limit.`};
  return {title: 'Mars held out', line: `Not terraformed by the end of generation ${s.last}: ${stepsText(s.steps)} still missing.`};
}

/** The generation line for headers: "Generation 5 of 14". */
export function soloGenerationText(s: SoloStatus): string {
  return `Generation ${s.generation} of ${s.last}`;
}

