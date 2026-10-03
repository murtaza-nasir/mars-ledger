// Achievements: each has one precise rule, checked when a game is recorded. A profile unlocks each
// achievement once, in the first game (by end time) where its rule holds; the server replays a
// profile's games in order to decide that, so re-recording or merging never double-counts.
import {isWin} from './profiles';
import type {GameResult} from './profiles';

export type Tier = 'bronze' | 'silver' | 'gold';

export type AchievementDef = {
  id: string;
  name: string;
  /** the rule, in the words shown on a locked badge */
  rule: string;
  tier: Tier;
  /** glyph drawn inside the badge (src/client/ui/Badge.tsx) */
  glyph: string;
  /** a caveat when the rule reads differently in one mode */
  note?: string;
  /** `r` is the game being checked; `upTo` is every game of this profile up to and including it, oldest first */
  check: (r: GameResult, upTo: GameResult[]) => boolean;
};

const MAPS = ['tharsis', 'hellas', 'elysium'] as const;

export const ACHIEVEMENTS: AchievementDef[] = [
  {id: 'first-landing', name: 'First landing', rule: 'Finish a game.', tier: 'bronze', glyph: 'lander',
    check: () => true},
  {id: 'first-victory', name: 'First victory', rule: 'Win a game against at least one other player.', tier: 'bronze', glyph: 'trophy',
    check: (r) => isWin(r)},
  {id: 'hat-trick', name: 'Hat trick', rule: 'Win 3 games.', tier: 'silver', glyph: 'three',
    check: (_r, upTo) => upTo.filter(isWin).length >= 3},
  {id: 'veteran', name: 'Veteran', rule: 'Finish 10 games.', tier: 'silver', glyph: 'chevrons',
    check: (_r, upTo) => upTo.length >= 10},
  {id: 'beginners-luck', name: "Beginner's luck", rule: 'Win with the Beginner Corporation.', tier: 'silver', glyph: 'clover',
    check: (r) => isWin(r) && r.beginner},
  {id: 'dead-heat', name: 'Dead heat', rule: 'Share first place with another player.', tier: 'silver', glyph: 'twin',
    check: (r) => isWin(r) && r.margin === 0},
  {id: 'photo-finish', name: 'Photo finish', rule: 'Win by 1 or 2 points.', tier: 'silver', glyph: 'flag',
    check: (r) => isWin(r) && r.margin >= 1 && r.margin <= 2},
  {id: 'landslide', name: 'Landslide', rule: 'Win by 20 points or more.', tier: 'gold', glyph: 'mountain',
    check: (r) => isWin(r) && r.margin >= 20},
  {id: 'last-drop', name: 'Last drop', rule: 'Place the ninth ocean.', tier: 'silver', glyph: 'drop',
    check: (r) => r.stats.maxed.includes('oceans')},
  {id: 'heat-wave', name: 'Heat wave', rule: 'Raise the temperature to +8 °C.', tier: 'silver', glyph: 'thermo',
    check: (r) => r.stats.maxed.includes('temperature')},
  {id: 'fresh-air', name: 'Breath of fresh air', rule: 'Raise oxygen to 14%.', tier: 'silver', glyph: 'o2',
    check: (r) => r.stats.maxed.includes('oxygen')},
  {id: 'chief-terraformer', name: 'Chief terraformer', rule: 'Raise more global parameter steps than anyone else in a game.', tier: 'silver', glyph: 'globe',
    check: (r) => r.players >= 2 && r.stats.mostSteps},
  {id: 'metropolis', name: 'Metropolis', rule: 'Place 3 or more cities in one game.', tier: 'bronze', glyph: 'city',
    check: (r) => r.stats.cities >= 3},
  {id: 'city-builder', name: 'City builder', rule: 'Place 10 cities across all your games.', tier: 'silver', glyph: 'skyline',
    check: (_r, upTo) => upTo.reduce((a, x) => a + x.stats.cities, 0) >= 10},
  {id: 'green-belt', name: 'Green belt', rule: 'Place 5 or more greeneries in one game.', tier: 'bronze', glyph: 'leaf',
    check: (r) => r.stats.greeneries >= 5},
  {id: 'deep-blue', name: 'Deep blue', rule: 'Place 20 oceans across all your games.', tier: 'gold', glyph: 'waves',
    check: (_r, upTo) => upTo.reduce((a, x) => a + x.stats.oceans, 0) >= 20},
  {id: 'card-shark', name: 'Card shark', rule: 'Play 20 or more project cards in one game.', tier: 'silver', glyph: 'cards',
    check: (r) => r.stats.cards >= 20},
  {id: 'big-spender', name: 'Big spender', rule: 'Spend 200 M€ or more in one game.', tier: 'silver', glyph: 'coin',
    note: 'In companion games only card costs are counted.',
    check: (r) => r.stats.mcSpent >= 200},
  {id: 'milestone-hunter', name: 'Milestone hunter', rule: 'Claim 2 milestones in one game.', tier: 'silver', glyph: 'pennant',
    check: (r) => r.stats.milestones.length >= 2},
  {id: 'ruthless', name: 'Ruthless', rule: 'Attack other players 3 or more times in one game.', tier: 'bronze', glyph: 'meteor',
    check: (r) => r.stats.attacks >= 3},
  {id: 'pacifist', name: 'Pacifist', rule: 'Win without attacking anyone.', tier: 'silver', glyph: 'dove',
    check: (r) => isWin(r) && r.stats.attacks === 0},
  {id: 'speedrun', name: 'Speedrun', rule: 'Terraform Mars completely by generation 10.', tier: 'gold', glyph: 'bolt',
    check: (r) => r.terraformed && r.generations <= 10},
  {id: 'marathon', name: 'Marathon', rule: 'Play a game to generation 16 or later.', tier: 'bronze', glyph: 'hourglass',
    check: (r) => r.generations >= 16},
  {id: 'tourist', name: 'Tourist', rule: 'Finish a game on Tharsis, Hellas and Elysium.', tier: 'silver', glyph: 'compass',
    check: (_r, upTo) => MAPS.every((m) => upTo.some((x) => x.board === m))},
  {id: 'cartographer', name: 'Cartographer', rule: 'Win on Tharsis, Hellas and Elysium.', tier: 'gold', glyph: 'map',
    check: (_r, upTo) => MAPS.every((m) => upTo.some((x) => x.board === m && isWin(x)))},
  {id: 'collector', name: 'Collector', rule: 'Play 10 different corporations.', tier: 'gold', glyph: 'stack',
    check: (_r, upTo) => new Set(upTo.flatMap((x) => x.corporations)).size >= 10},
];

export const ACHIEVEMENT_BY_ID = new Map(ACHIEVEMENTS.map((a) => [a.id, a]));

/**
 * Replay a profile's games oldest first and return, for each achievement, the game that unlocked it.
 * Deterministic: the same results always give the same unlocks.
 */
export function unlocksFor(results: GameResult[]): Array<{achievement: string; gameId: string; at: number}> {
  const ordered = [...results].sort((a, b) => a.endedAt - b.endedAt || a.gameId.localeCompare(b.gameId));
  const out: Array<{achievement: string; gameId: string; at: number}> = [];
  const done = new Set<string>();
  for (let i = 0; i < ordered.length; i++) {
    const r = ordered[i];
    const upTo = ordered.slice(0, i + 1);
    for (const a of ACHIEVEMENTS) {
      if (done.has(a.id)) continue;
      if (a.check(r, upTo)) { done.add(a.id); out.push({achievement: a.id, gameId: r.gameId, at: r.endedAt}); }
    }
  }
  return out;
}
