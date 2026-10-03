// One game (or the rest of one) in the in-process engine, with a policy per seat. Shared by the arena (whole games,
// judge vs Normal vs Normal) and the offline probe (rollouts after a candidate move).
import type {PlayerViewModel} from '../../src/shared/full';
import {deadEndReason} from '../../src/shared/deadend';
import {decide} from '../../src/server/full/bots/decide';
import type {Decision} from '../../src/server/full/bots/decide';
import type {BotLevel} from '../../src/shared/bots';
import {act, isOver, scores, view, waiting} from './engine';
import type {EngineGame, EnginePlayer, FinalScore} from './engine';

/** A seat's policy: answers a prompt (may be async, e.g. a judge asking a model). */
export type Policy = (model: PlayerViewModel, avoid: Set<string>) => Promise<Decision | null> | Decision | null;

/** A heuristic seat; `v1` plays Normal without the endgame rules (for measurement only). */
export function heuristic(level: BotLevel, rng: () => number = Math.random, v1 = false): Policy {
  return (m, avoid) => decide(m.waitingFor!, m, {level, rng, avoid, v1});
}

export type PlayResult = {over: boolean; decisions: number; refused: number; deadEnd?: string; error?: string; generation: number; scores: FinalScore[]};

/** Play until the game ends (or `limit` decisions). `policies` is keyed by engine player id; after a refusal a seat
 *  in `v1Seats` falls back to Normal v1, any other to the current Normal. */
export async function playOut(game: EngineGame, policies: Record<string, Policy>, limit = 4000, v1Seats: ReadonlySet<string> = new Set()): Promise<PlayResult> {
  let decisions = 0, refused = 0;
  while (!isOver(game) && decisions < limit) {
    const ws: EnginePlayer[] = waiting(game);
    if (!ws.length) return {over: false, decisions, refused, error: `nobody to move in phase ${game.phase}`, generation: game.generation, scores: scores(game)};
    // Simultaneous prompts (draft, research) are answered in parallel, as at a real table.
    const results = await Promise.all(ws.map(async (p) => {
      const avoid = new Set<string>();
      for (let attempt = 0; attempt < 12; attempt++) {
        const m = view(p);
        const w = m.waitingFor;
        if (!w) return 'moved';
        const dead = deadEndReason(w);
        if (dead) return `dead:${dead}`;
        const d = (attempt === 0 ? await policies[p.id](m, avoid) : null) ?? decide(w, m, {level: 'normal', rng: Math.random, avoid, v1: v1Seats.has(p.id)});
        if (!d) return 'stuck';
        try { act(p, d.response); decisions++; return 'ok'; } catch { refused++; avoid.add(d.path); }
      }
      return 'stuck';
    }));
    const bad = results.find((r) => r.startsWith('dead:') || r === 'stuck');
    if (bad) return {over: false, decisions, refused, deadEnd: bad, generation: game.generation, scores: scores(game)};
  }
  return {over: isOver(game), decisions, refused, generation: game.generation, scores: scores(game)};
}

/** Final margin of one player: own VP minus the best rival's VP. */
export function margin(s: FinalScore[], color: string): number {
  const me = s.find((x) => x.color === color)!;
  return me.vp - Math.max(...s.filter((x) => x.color !== color).map((x) => x.vp));
}

/** Engine ranking: most VP, ties broken by M€. */
export function winner(s: FinalScore[]): string {
  return [...s].sort((a, b) => b.vp - a.vp || b.mc - a.mc)[0].color;
}

export function seeded(seed: number): () => number {
  let a = seed >>> 0 || 1;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
