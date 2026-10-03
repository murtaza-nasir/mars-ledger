// Turn game changes into sound cues. Self-contained on purpose: the TV's animation diff lives in
// tv/full and changes with the visuals; sound only needs a coarse reading of what happened.
import {GLOBAL} from '../../../shared/board';
import {findCard} from '../../../shared/cards';
import type {GameEvent} from '../../../shared/game';
import {tileKind} from '../../../shared/full';
import type {PublicPlayerModel, SpectatorModel} from '../../../shared/full';
import type {Sfx} from './synth';
import {isRewind} from '../../../shared/sync';

export type Cue = {sfx: Sfx; level?: number};

const pct = (param: 'temperature' | 'oxygen' | 'oceans', v: number) =>
  (v - GLOBAL[param].min) / (GLOBAL[param].max - GLOBAL[param].min);

export function cardCue(name: string): Sfx {
  const c = findCard(name);
  if (!c) return 'cardAutomated';
  if (c.group === 'corporation') return 'cardCorp';
  return c.type === 'event' ? 'cardEvent' : c.type === 'active' ? 'cardActive' : 'cardAutomated';
}

function globalCues(param: 'temperature' | 'oxygen' | 'oceans', from: number, to: number, tilePlayed: boolean): Cue[] {
  if (to <= from) return [];
  const out: Cue[] = [];
  // oceans already sound through their tile; a raise without a tile (companion) gets its own tone
  if (param === 'temperature') out.push({sfx: 'temperature', level: pct(param, to)});
  if (param === 'oxygen' && !tilePlayed) out.push({sfx: 'oxygen', level: pct(param, to)});
  if (param === 'oceans' && !tilePlayed) out.push({sfx: 'oceanParam', level: pct(param, to)});
  if (to >= GLOBAL[param].max) out.push({sfx: 'maxed'});
  return out;
}

/** Companion mode: the engine's own events for one move. */
/** A tile's cue by its kind. */
export function tileCue(tileType: number | undefined): Sfx {
  const k = tileKind(tileType);
  return k === 'ocean' ? 'ocean' : k === 'greenery' ? 'greenery' : k === 'city' ? 'city' : 'special';
}

export function companionCues(events: GameEvent[]): Cue[] {
  const out: Cue[] = [];
  const tiles = events.filter((e) => e.kind === 'tile');
  if (events.some((e) => e.kind === 'production')) return [{sfx: 'productionLite'}];
  for (const e of events) {
    switch (e.kind) {
    case 'cardPlayed': out.push({sfx: e.cardType === 'event' ? 'cardEvent' : e.cardType === 'active' ? 'cardActive' : 'cardAutomated'}); break;
    case 'corp': out.push({sfx: 'cardCorp'}); break;
    case 'tile': out.push({sfx: e.tile === 'ocean' ? 'ocean' : e.tile === 'greenery' ? 'greenery' : e.tile === 'city' ? 'city' : 'special'}); break;
    case 'global':
      if (e.param !== 'venus') out.push(...globalCues(e.param, e.from, e.to, tiles.some((t) => t.kind === 'tile' && (t.tile === 'ocean' ? e.param === 'oceans' : t.tile === 'greenery' && e.param === 'oxygen'))));
      break;
    case 'attack': out.push({sfx: 'attack'}); break;
    case 'milestone': out.push({sfx: 'milestone'}); break;
    case 'award': out.push({sfx: 'award'}); break;
    case 'turn': out.push({sfx: 'turn'}); break;
    case 'ended': out.push({sfx: 'gameEnd'}); break;
    }
  }
  return out;
}

const STOCK: Array<keyof PublicPlayerModel> = ['megacredits', 'steel', 'titanium', 'plants', 'energy', 'heat',
  'megacreditProduction', 'steelProduction', 'titaniumProduction', 'plantProduction', 'energyProduction', 'heatProduction', 'terraformRating'];

/** What the TV's move pipeline sounds itself, as it presents it (pipeline/sequence.ts): left out here. */
export type CueSkip = {cards: ReadonlySet<string>; tiles: ReadonlySet<string>; attack: boolean};

/** Full mode: compare two spectator models. */
export function fullCues(prev: SpectatorModel | null, next: SpectatorModel, skip?: CueSkip): Cue[] {
  if (!prev || isRewind(prev.game, next.game)) return [];
  const g0 = prev.game; const g1 = next.game;
  const out: Cue[] = [];
  const before = new Map(g0.spaces.map((s) => [s.id, s]));
  const newTiles = g1.spaces.filter((s) => s.tileType !== undefined && before.get(s.id)?.tileType === undefined);
  for (const s of newTiles) {
    if (skip?.tiles.has(s.id)) continue;
    const k = tileKind(s.tileType);
    out.push({sfx: k === 'ocean' ? 'ocean' : k === 'greenery' ? 'greenery' : k === 'city' ? 'city' : 'special'});
  }
  const kinds = new Set(newTiles.map((s) => tileKind(s.tileType)));
  out.push(...globalCues('temperature', g0.temperature, g1.temperature, false));
  out.push(...globalCues('oxygen', g0.oxygenLevel, g1.oxygenLevel, kinds.has('greenery')));
  out.push(...globalCues('oceans', g0.oceans, g1.oceans, kinds.has('ocean')));

  for (const p of next.players) {
    const old = prev.players.find((x) => x.color === p.color);
    if (!old) continue;
    const had = new Set(old.tableau.map((c) => c.name));
    for (const c of p.tableau) if (!had.has(c.name) && !skip?.cards.has(`${p.color}|${c.name}`)) out.push({sfx: cardCue(c.name)});
  }

  // an attack: in the action phase, someone other than the acting player lost something
  if (g0.phase === 'action' && g1.phase === 'action' && g0.generation === g1.generation) {
    const actor = prev.players.find((p) => p.isActive)?.color;
    const greenBy = new Set(newTiles.filter((s) => tileKind(s.tileType) === 'greenery').map((s) => s.color));
    const hit = next.players.some((p) => {
      if (p.color === actor || greenBy.has(p.color)) return false;
      const old = prev.players.find((x) => x.color === p.color);
      if (!old) return false;
      if (STOCK.some((k) => (p[k] as number) < (old[k] as number))) return true;
      return p.tableau.some((c) => (c.resources ?? 0) < (old.tableau.find((o) => o.name === c.name)?.resources ?? 0));
    });
    if (hit && !skip?.attack) out.push({sfx: 'attack'});
  }

  const claimed = (m: SpectatorModel['game']['milestones']) => m.filter((x) => x.color).length;
  if (claimed(g1.milestones) > claimed(g0.milestones)) out.push({sfx: 'milestone'});
  if (claimed(g1.awards) > claimed(g0.awards)) out.push({sfx: 'award'});

  const active0 = prev.players.find((p) => p.isActive)?.color;
  const active1 = next.players.find((p) => p.isActive)?.color;
  if (active1 && active1 !== active0 && g1.phase === 'action') out.push({sfx: 'turn'});
  if (g1.phase === 'end' && g0.phase !== 'end') out.push({sfx: 'gameEnd'});
  return out;
}

export function progressOf(g: {temperature: number; oxygen: number; oceans: number}): number {
  return (pct('temperature', g.temperature) + pct('oxygen', g.oxygen) + pct('oceans', g.oceans)) / 3;
}
