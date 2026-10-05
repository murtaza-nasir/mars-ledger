// A game's story: per-generation stats, the order tiles went down, and the TR/VP race.
// Built on the server from consecutive engine spectator models (full mode) or from the command log
// (companion mode), persisted, and sent to the TV for recaps and the end-of-game story.
import {findCard} from './cards';
import {detectAttack} from './attack';
import {isRewind} from './sync';
import type {AttackTarget, Loss} from './attack';
import type {Color, SpaceModel, SpectatorModel} from './full';
import {tileKind} from './full';
import type {GameState, Tick} from './game';

export type TileCounts = {city: number; greenery: number; ocean: number; special: number};

export type PlayerGen = {
  color: Color;
  cards: Array<{name: string; cost: number}>;
  tiles: TileCounts;
  trGained: number;
  mcSpent: number;
  /** resource units taken from others (stock, production steps, TR, card resources) */
  dealt: number;
  received: number;
  /** global parameter steps raised by this player's actions */
  globalSteps: number;
  milestones: string[];
  awards: string[];
};

export type AttackRecord = {attacker: Color; targets: AttackTarget[]; units: number};

export type GenRecord = {
  generation: number;
  closed: boolean;
  players: PlayerGen[];
  params: {temperature: [number, number]; oxygen: [number, number]; oceans: [number, number]};
  attacks: AttackRecord[];
  /** TR and VP when the generation closed (or the latest seen while open) */
  tr: Record<string, number>;
  vp: Record<string, number>;
};

export type TileRecord = {spaceId: string; tileType: number; color?: Color; by?: Color; generation: number; order: number};

export type GameHistory = {
  id: string;
  mode: 'full' | 'companion';
  players: Array<{color: Color; name: string; corporation?: string}>;
  startTR: Record<string, number>;
  generations: GenRecord[];
  tiles: TileRecord[];
  /** the board with every tile, once the game has ended (full mode) */
  finalSpaces?: SpaceModel[];
  /** who took each global parameter to its maximum (the step that reached it) */
  maxedBy?: Partial<Record<'temperature' | 'oxygen' | 'oceans', Color>>;
  /** moves taken back with the engine's undo (full mode); the story itself no longer counts them */
  undos?: Array<{generation: number; color: Color}>;
  ended: boolean;
};

const emptyTiles = (): TileCounts => ({city: 0, greenery: 0, ocean: 0, special: 0});
const emptyPlayer = (color: Color): PlayerGen => ({color, cards: [], tiles: emptyTiles(), trGained: 0, mcSpent: 0, dealt: 0, received: 0,
  globalSteps: 0, milestones: [], awards: []});

export function newHistory(id: string, mode: GameHistory['mode']): GameHistory {
  return {id, mode, players: [], startTR: {}, generations: [], tiles: [], ended: false};
}

function openGen(h: GameHistory, generation: number, params: GenRecord['params']): GenRecord {
  let g = h.generations.find((x) => x.generation === generation);
  if (!g) {
    g = {generation, closed: false, players: h.players.map((p) => emptyPlayer(p.color)), params, attacks: [], tr: {}, vp: {}};
    h.generations.push(g);
  }
  return g;
}

function pg(g: GenRecord, color: Color): PlayerGen {
  let p = g.players.find((x) => x.color === color);
  if (!p) { p = emptyPlayer(color); g.players.push(p); }
  return p;
}

export function lossUnits(targets: AttackTarget[]): number {
  return targets.reduce((a, t) => a + t.losses.reduce((b, l) => b + l.amount, 0), 0);
}

function tileKey(t: number): keyof TileCounts {
  const k = tileKind(t);
  return k === 'greenery' ? 'greenery' : k === 'ocean' ? 'ocean' : k === 'city' ? 'city' : 'special';
}

function snapshotRace(g: GenRecord, m: SpectatorModel) {
  for (const p of m.players) {
    g.tr[p.color] = p.terraformRating;
    g.vp[p.color] = p.victoryPointsBreakdown?.total ?? p.terraformRating;
  }
}

/**
 * Fold one engine update into the history. `prev` is the model seen just before `next` for the same
 * game (null on first sight). Returns what kind of change happened so the caller can decide to persist
 * and broadcast.
 */
export function observeFull(h: GameHistory, prev: SpectatorModel | null, next: SpectatorModel): {closed?: number; ended?: boolean; changed: boolean} {
  const g1 = next.game;
  let renamed = false;
  for (const p of next.players) {
    if (!h.players.some((x) => x.color === p.color)) h.players.push({color: p.color, name: p.name});
    const hp = h.players.find((x) => x.color === p.color)!;
    // the server relabels models with the seats' current names: a renamed player's stored name follows (src/shared/names.ts)
    if (p.name && hp.name !== p.name) { hp.name = p.name; renamed = true; }
    const corp = p.tableau.find((c) => findCard(c.name)?.group === 'corporation')?.name;
    if (corp) hp.corporation = corp;
    // Everyone starts on 20 TR (14 solo); first sight may already be later in the game.
    if (h.startTR[p.color] === undefined) h.startTR[p.color] = Math.min(next.players.length === 1 ? 14 : 20, p.terraformRating);
  }
  const params = (): GenRecord['params'] => ({temperature: [g1.temperature, g1.temperature], oxygen: [g1.oxygenLevel, g1.oxygenLevel], oceans: [g1.oceans, g1.oceans]});
  if (!prev) {
    const g = openGen(h, g1.generation, params());
    snapshotRace(g, next);
    // Tiles already on the board when we first look (e.g. after a server restart) keep their place in the story.
    for (const s of g1.spaces) {
      if (s.tileType !== undefined && !h.tiles.some((t) => t.spaceId === s.id)) {
        h.tiles.push({spaceId: s.id, tileType: s.tileType, color: s.color, generation: g1.generation, order: h.tiles.length});
      }
    }
    return {changed: true};
  }
  // an undo (or a repeated one: undoCount can stay put while gameAge falls) is folded by the caller (HistoryKeeper.rewind)
  if (isRewind(prev.game, g1)) return {changed: renamed};
  const out: {closed?: number; ended?: boolean; changed: boolean} = {changed: renamed};

  // A new generation closes the previous one with its pre-production numbers.
  if (g1.generation > prev.game.generation) {
    const old = openGen(h, prev.game.generation, params());
    if (!old.closed) { snapshotRace(old, prev); old.closed = true; out.closed = old.generation; }
    const g = openGen(h, g1.generation, params());
    g.params = params();
    out.changed = true;
  }
  const g = openGen(h, g1.generation, params());
  const actor = prev.players.find((p) => p.isActive)?.color;

  // Tiles, in the order they went down.
  const before = new Map(prev.game.spaces.map((s) => [s.id, s]));
  for (const s of g1.spaces) {
    if (s.tileType === undefined || before.get(s.id)?.tileType !== undefined) continue;
    const by = s.color ?? actor;
    h.tiles.push({spaceId: s.id, tileType: s.tileType, color: s.color, by, generation: g1.generation, order: h.tiles.length});
    if (by) pg(g, by).tiles[tileKey(s.tileType)]++;
    out.changed = true;
  }

  // Global parameters: steps credited to whoever was acting.
  const steps = (g1.temperature - prev.game.temperature) / 2 + (g1.oxygenLevel - prev.game.oxygenLevel) + (g1.oceans - prev.game.oceans);
  if (steps > 0 && actor) pg(g, actor).globalSteps += steps;
  if (actor) {
    const maxed = h.maxedBy ??= {};
    if (g1.temperature >= 8 && prev.game.temperature < 8) maxed.temperature ??= actor;
    if (g1.oxygenLevel >= 14 && prev.game.oxygenLevel < 14) maxed.oxygen ??= actor;
    if (g1.oceans >= 9 && prev.game.oceans < 9) maxed.oceans ??= actor;
  }
  g.params.temperature[1] = g1.temperature; g.params.oxygen[1] = g1.oxygenLevel; g.params.oceans[1] = g1.oceans;

  const attack = detectAttack(prev, next);
  const hitColors = new Set(attack?.targets.map((t) => t.color) ?? []);
  if (attack) {
    const units = lossUnits(attack.targets);
    g.attacks.push({attacker: attack.attacker, targets: attack.targets, units});
    pg(g, attack.attacker).dealt += units;
    for (const t of attack.targets) pg(g, t.color).received += lossUnits([t]);
    out.changed = true;
  }

  const was = new Map(prev.players.map((p) => [p.color, p]));
  for (const p of next.players) {
    const o = was.get(p.color);
    if (!o) continue;
    const me = pg(g, p.color);
    const had = new Set(o.tableau.map((c) => c.name));
    for (const c of p.tableau) {
      if (had.has(c.name)) continue;
      const def = findCard(c.name);
      if (!def || def.group !== 'project') continue;
      me.cards.push({name: c.name, cost: def.cost ?? 0});
      out.changed = true;
    }
    if (p.terraformRating > o.terraformRating) me.trGained += p.terraformRating - o.terraformRating;
    // Money that left a player who was not being attacked was spent (cards, projects, research buys).
    const drop = o.megacredits - p.megacredits;
    if (drop > 0 && !hitColors.has(p.color) && g1.generation === prev.game.generation) me.mcSpent += drop;
  }
  for (const [kind, list0, list1] of [['milestones', prev.game.milestones, g1.milestones], ['awards', prev.game.awards, g1.awards]] as const) {
    for (const m of list1) {
      if (!m.color || list0.find((x) => x.name === m.name)?.color) continue;
      pg(g, m.color)[kind].push(m.name);
      out.changed = true;
    }
  }
  snapshotRace(g, next);
  if (g1.phase === 'end' && !h.ended) {
    h.ended = true;
    g.closed = true;
    h.finalSpaces = g1.spaces;
    out.ended = true;
    out.changed = true;
  }
  return out;
}

/** The last production of the game does not advance the generation; the bridge closes it explicitly. */
export function closeGeneration(h: GameHistory, pre: SpectatorModel): number | null {
  const g = h.generations.find((x) => x.generation === pre.game.generation);
  if (!g || g.closed) return null;
  snapshotRace(g, pre);
  g.closed = true;
  return g.generation;
}

// ---- companion mode: the same story from the command log -------------------------------------
/** The companion engine words attacks like "−2 plants", "−1 heat production", "stole 3 M€". */
export function companionLoss(what: string): Loss {
  const m = what.match(/(\d+)\s*(M€|steel|titanium|plants|energy|heat)?(\s+production)?/);
  const amount = m ? Number(m[1]) : 1;
  const resource = m?.[2] ? (m[2] === 'M€' ? 'megacredits' : m[2]) : undefined;
  return {what: m?.[3] ? 'production' : 'stock', resource, amount};
}

export function companionHistory(state: GameState, ticks: Tick[]): GameHistory {
  const h = newHistory(state.id, 'companion');
  const color = new Map(state.players.map((p) => [p.id, p.color as Color]));
  for (const p of state.players) h.players.push({color: p.color as Color, name: p.name, corporation: p.corporation ?? undefined});
  const tr: Record<string, number> = {};
  for (const p of state.players) { tr[p.color] = 20; h.startTR[p.color] = 20; }
  let gen = 1;
  const params = {temperature: -30, oxygen: 0, oceans: 0};
  const open = () => openGen(h, gen, {temperature: [params.temperature, params.temperature], oxygen: [params.oxygen, params.oxygen], oceans: [params.oceans, params.oceans]});
  for (const t of ticks) {
    for (const e of t.events) {
      if (e.kind === 'started' || e.kind === 'joined') continue;
      const g = open();
      const c = 'player' in e && e.player ? color.get(e.player) : undefined;
      switch (e.kind) {
      case 'cardPlayed': if (c) { pg(g, c).cards.push({name: e.card, cost: e.cost}); pg(g, c).mcSpent += e.cost; } break;
      case 'tile': {
        const tileType = e.tile === 'greenery' ? 0 : e.tile === 'ocean' ? 1 : e.tile === 'city' ? 2 : 11;
        h.tiles.push({spaceId: '', tileType, color: e.tile === 'ocean' ? undefined : c, by: c, generation: gen, order: h.tiles.length});
        if (c) pg(g, c).tiles[e.tile === 'special' ? 'special' : e.tile]++;
        break;
      }
      case 'global': {
        if (e.param === 'venus') break;
        // A correction on the phone (setGlobal) fixes the record; it is not terraforming.
        if (t.command.t === 'setGlobal') { g.params[e.param][0] += e.to - e.from; params[e.param] = e.to; g.params[e.param][1] = e.to; break; }
        const steps = (e.to - e.from) / (e.param === 'temperature' ? 2 : 1);
        if (c && steps > 0) pg(g, c).globalSteps += steps;
        const max = e.param === 'temperature' ? 8 : e.param === 'oxygen' ? 14 : 9;
        if (c && e.to >= max && e.from < max) (h.maxedBy ??= {})[e.param] ??= c;
        params[e.param] = e.to; g.params[e.param][1] = e.to;
        break;
      }
      case 'tr': if (c) { tr[c] += e.delta; if (e.delta > 0) pg(g, c).trGained += e.delta; } break;
      case 'attack': {
        const target = color.get(e.target);
        if (!c || !target) break;
        const loss = companionLoss(e.what);
        const units = loss.amount;
        const targets: AttackTarget[] = [{color: target, losses: [loss]}];
        g.attacks.push({attacker: c, targets, units});
        pg(g, c).dealt += units; pg(g, target).received += units;
        break;
      }
      case 'milestone': if (c) pg(g, c).milestones.push(e.name); break;
      case 'award': if (c) pg(g, c).awards.push(e.name); break;
      case 'production':
        g.tr = {...tr}; g.vp = {...tr}; g.closed = true;
        gen = e.generation + 1;
        break;
      case 'ended': g.tr = {...tr}; g.vp = {...tr}; g.closed = true; h.ended = true; break;
      default: break;
      }
      if (!g.closed) g.tr = {...tr};
    }
  }
  return h;
}

// ---- derived views ---------------------------------------------------------------------------
export type Totals = PlayerGen;

export function totals(h: GameHistory): Totals[] {
  return h.players.map((p) => {
    const t = emptyPlayer(p.color);
    for (const g of h.generations) {
      const x = g.players.find((y) => y.color === p.color);
      if (!x) continue;
      t.cards.push(...x.cards);
      for (const k of Object.keys(t.tiles) as Array<keyof TileCounts>) t.tiles[k] += x.tiles[k];
      t.trGained += x.trGained; t.mcSpent += x.mcSpent; t.dealt += x.dealt; t.received += x.received;
      t.globalSteps += x.globalSteps; t.milestones.push(...x.milestones); t.awards.push(...x.awards);
    }
    return t;
  });
}

/** TR per player at the start and at the close of every generation, for the race chart. */
export function trRace(h: GameHistory): Array<{color: Color; points: Array<{generation: number; tr: number}>}> {
  return h.players.map((p) => ({
    color: p.color,
    points: [{generation: 0, tr: h.startTR[p.color] ?? 20},
      ...h.generations.filter((g) => g.tr[p.color] !== undefined).sort((a, b) => a.generation - b.generation).map((g) => ({generation: g.generation, tr: g.tr[p.color]}))],
  }));
}

export type Highlights = {
  generation: number;
  biggestPlay?: {color: Color; name: string; cost: number};
  harshestAttack?: AttackRecord;
  mostTiles?: {color: Color; count: number; tiles: TileCounts};
  terraforming: {temperature: number; oxygen: number; oceans: number};
};

export function highlights(g: GenRecord): Highlights {
  let biggestPlay: Highlights['biggestPlay'];
  for (const p of g.players) for (const c of p.cards) if (!biggestPlay || c.cost > biggestPlay.cost) biggestPlay = {color: p.color, name: c.name, cost: c.cost};
  const harshestAttack = [...g.attacks].sort((a, b) => b.units - a.units)[0];
  let mostTiles: Highlights['mostTiles'];
  for (const p of g.players) {
    const count = p.tiles.city + p.tiles.greenery + p.tiles.ocean + p.tiles.special;
    if (count > 0 && (!mostTiles || count > mostTiles.count)) mostTiles = {color: p.color, count, tiles: p.tiles};
  }
  return {
    generation: g.generation, biggestPlay, harshestAttack, mostTiles,
    terraforming: {temperature: (g.params.temperature[1] - g.params.temperature[0]) / 2, oxygen: g.params.oxygen[1] - g.params.oxygen[0], oceans: g.params.oceans[1] - g.params.oceans[0]},
  };
}

export type Title = {color: Color; title: string; detail: string};

const METRICS: Array<{key: string; title: string; value: (t: Totals) => number; detail: (n: number) => string}> = [
  {key: 'ruthless', title: 'Most ruthless', value: (t) => t.dealt, detail: (n) => `took ${n} from rivals`},
  {key: 'green', title: 'Green thumb', value: (t) => t.tiles.greenery, detail: (n) => `${n} greener${n === 1 ? 'y' : 'ies'} planted`},
  {key: 'urban', title: 'Urban planner', value: (t) => t.tiles.city, detail: (n) => `${n} cit${n === 1 ? 'y' : 'ies'} founded`},
  {key: 'spender', title: 'Big spender', value: (t) => t.mcSpent, detail: (n) => `${n} M€ spent`},
  {key: 'terraformer', title: 'Terraformer-in-chief', value: (t) => t.globalSteps, detail: (n) => `${n} global step${n === 1 ? '' : 's'}`},
  {key: 'cards', title: 'Card shark', value: (t) => t.cards.length, detail: (n) => `${n} card${n === 1 ? '' : 's'} played`},
  {key: 'oceans', title: 'Water bearer', value: (t) => t.tiles.ocean, detail: (n) => `${n} ocean${n === 1 ? '' : 's'} placed`},
];

/**
 * One title per player: each metric's leader, strongest leads first, no title given twice.
 * A player who leads nothing gets their best remaining metric, or a fallback.
 */
export function titles(h: GameHistory): Title[] {
  const tot = totals(h);
  const cands: Array<{color: Color; m: typeof METRICS[number]; value: number; margin: number}> = [];
  for (const m of METRICS) {
    const vals = tot.map((t) => ({color: t.color, v: m.value(t)})).sort((a, b) => b.v - a.v);
    if (!vals.length || vals[0].v <= 0) continue;
    const second = vals[1]?.v ?? 0;
    for (const x of vals) {
      if (x.v !== vals[0].v) break;
      cands.push({color: x.color, m, value: x.v, margin: (x.v - second) / Math.max(1, x.v)});
    }
  }
  cands.sort((a, b) => b.margin - a.margin || b.value - a.value);
  const out = new Map<Color, Title>();
  const used = new Set<string>();
  for (const c of cands) {
    if (out.has(c.color) || used.has(c.m.key)) continue;
    out.set(c.color, {color: c.color, title: c.m.title, detail: c.m.detail(c.value)});
    used.add(c.m.key);
  }
  for (const t of tot) {
    if (out.has(t.color)) continue;
    const best = METRICS.filter((m) => !used.has(m.key)).map((m) => ({m, v: m.value(t)})).sort((a, b) => b.v - a.v)[0];
    if (best && best.v > 0) { out.set(t.color, {color: t.color, title: best.m.title, detail: best.m.detail(best.v)}); used.add(best.m.key); }
    else out.set(t.color, {color: t.color, title: 'Steady hand', detail: `${t.trGained} TR gained`});
  }
  return h.players.map((p) => out.get(p.color)!).filter(Boolean);
}
