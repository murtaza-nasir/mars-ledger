// The end-of-game poster: what it says (facts built from a finished game), which painting from the
// library in public/posters fits it best, and the prompt for the optional one-off illustration.
// Pure: the server renders it (src/server/poster), phones and the TV only show the result.
import {GLOBAL} from './board';
import type {BoardName} from './board';
import {findCard} from './cards';
import {score} from './engine';
import type {GameState} from './game';
import {tileKind} from './full';
import type {SpaceModel, SpectatorModel} from './full';
import {titles, totals} from './history';
import type {GameHistory} from './history';
import {placements} from './profiles';

// ---- facts ------------------------------------------------------------------------------------
export type PosterPlayer = {
  name: string;
  color: string;
  vp: number;
  /** 1 = winner; ties share a place */
  placement: number;
  tr: number | null;
  corporation: string | null;
  /** card number of the corporation, which is also its portrait file (e.g. 'R09') */
  portrait: string | null;
  /** the story's title for this player, e.g. 'Green thumb', with its detail */
  title: string | null;
  detail: string | null;
};

export type PosterFacts = {
  gameId: string;
  mode: 'companion' | 'full';
  board: BoardName;
  endedAt: number;
  generations: number;
  temperature: number;
  oxygen: number;
  oceans: number;
  /** tiles on the planet, whole table */
  greenery: number;
  cities: number;
  special: number;
  terraformed: boolean;
  players: PosterPlayer[];
  /** full games: the final board, every tile in place. Companion games have no positions. */
  spaces: SpaceModel[] | null;
};

const corpOf = (names: string[]) => names.find((n) => findCard(n)?.group === 'corporation') ?? null;
const portraitOf = (corp: string | null) => (corp ? findCard(corp)?.number ?? null : null);
const isTerraformed = (t: number, o: number, oc: number) => t >= GLOBAL.temperature.max && o >= GLOBAL.oxygen.max && oc >= GLOBAL.oceans.max;

function titleMap(history: GameHistory | null): Map<string, {title: string; detail: string}> {
  const out = new Map<string, {title: string; detail: string}>();
  if (!history || !totals(history).length) return out;
  for (const t of titles(history)) out.set(t.color, {title: t.title, detail: t.detail});
  return out;
}

function ranked(players: Omit<PosterPlayer, 'placement'>[]): PosterPlayer[] {
  const place = placements(players.map((p) => p.vp));
  return players.map((p, i) => ({...p, placement: place[i]})).sort((a, b) => a.placement - b.placement || b.vp - a.vp || a.name.localeCompare(b.name));
}

/** Companion: tile counts and parameters from our engine; no tile positions. */
export function companionFacts(state: GameState, history: GameHistory | null, endedAt = state.endedAt ?? Date.now()): PosterFacts {
  const t = titleMap(history);
  const players = ranked(state.players.map((p) => ({
    name: p.name, color: p.color, vp: score(state, p).total, tr: p.tr,
    corporation: p.corporation ?? null, portrait: portraitOf(p.corporation ?? null),
    title: t.get(p.color)?.title ?? null, detail: t.get(p.color)?.detail ?? null,
  })));
  const sum = (f: (p: GameState['players'][number]) => number) => state.players.reduce((a, p) => a + f(p), 0);
  const g = state.global;
  return {
    gameId: state.id, mode: 'companion', board: state.board ?? 'tharsis', endedAt, generations: state.generation,
    temperature: g.temperature, oxygen: g.oxygen, oceans: g.oceans,
    greenery: sum((p) => p.tiles.greenery), cities: sum((p) => p.tiles.cityOnMars + p.tiles.cityOffMars), special: sum((p) => p.tiles.special),
    terraformed: isTerraformed(g.temperature, g.oxygen, g.oceans), players, spaces: null,
  };
}

/** Full: the engine's final model; names come from the lobby seats where known. */
export function fullFacts(state: GameState, final: SpectatorModel, history: GameHistory | null, endedAt = Date.now()): PosterFacts {
  const t = titleMap(history);
  const byColor = new Map(Object.entries(state.full?.players ?? {}).map(([playerId, seat]) => [seat.color as string, playerId]));
  const players = ranked(final.players.map((ep) => {
    const lobby = state.players.find((p) => p.id === byColor.get(ep.color));
    const corp = corpOf(ep.tableau.map((c) => c.name));
    return {
      name: lobby?.name ?? ep.name, color: ep.color, vp: ep.victoryPointsBreakdown?.total ?? ep.terraformRating, tr: ep.terraformRating,
      corporation: corp, portrait: portraitOf(corp), title: t.get(ep.color)?.title ?? null, detail: t.get(ep.color)?.detail ?? null,
    };
  }));
  const g = final.game;
  const count = (k: string) => g.spaces.filter((s) => tileKind(s.tileType) === k).length;
  return {
    gameId: state.full?.gameId ?? state.id, mode: 'full', board: state.board ?? 'tharsis', endedAt, generations: g.generation,
    temperature: g.temperature, oxygen: g.oxygenLevel, oceans: g.oceans,
    greenery: count('greenery'), cities: count('city'), special: count('special'),
    terraformed: g.isTerraformed || isTerraformed(g.temperature, g.oxygenLevel, g.oceans), players, spaces: g.spaces,
  };
}

// ---- matching a painting ----------------------------------------------------------------------
export type OceanLevel = 'low' | 'mid' | 'full';
export type PaintingAxes = {oceans: OceanLevel; greenery: 'sparse' | 'lush'; cities: 'few' | 'dense'; warmth: 'cold' | 'warm'; view: 'orbit' | 'surface'; barren?: boolean};
export type Painting = PaintingAxes & {file: string};

/** How far Mars got: 0 untouched, 1 fully terraformed (the three global parameters, equally weighted). */
export function terraformProgress(f: Pick<PosterFacts, 'temperature' | 'oxygen' | 'oceans'>): number {
  const t = (f.temperature - GLOBAL.temperature.min) / (GLOBAL.temperature.max - GLOBAL.temperature.min);
  const o = f.oxygen / GLOBAL.oxygen.max;
  const oc = f.oceans / GLOBAL.oceans.max;
  return Math.max(0, Math.min(1, (t + o + oc) / 3));
}

/** A game that stopped early (little terraforming) gets one of the barren paintings. */
export const BARREN_BELOW = 0.3;
/** Table-wide tile totals above which the painting shows a lush / dense planet. */
export const LUSH_FROM = 8;
export const DENSE_FROM = 6;

/** Small deterministic hash so a game always gets the same view, and games alternate between views. */
export function hashOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function wantedAxes(f: PosterFacts): PaintingAxes {
  const barren = terraformProgress(f) < BARREN_BELOW;
  return {
    oceans: f.oceans >= GLOBAL.oceans.max ? 'full' : f.oceans >= 4 ? 'mid' : 'low',
    greenery: f.greenery >= LUSH_FROM ? 'lush' : 'sparse',
    cities: f.cities >= DENSE_FROM ? 'dense' : 'few',
    warmth: f.temperature < 0 ? 'cold' : 'warm',
    view: hashOf(f.gameId) % 2 === 0 ? 'orbit' : 'surface',
    barren,
  };
}

const OCEAN_RANK: Record<OceanLevel, number> = {low: 0, mid: 1, full: 2};

/** Distance between what the game looked like and a painting; the weights say what matters most. */
export function paintingDistance(want: PaintingAxes, p: PaintingAxes): number {
  let d = 0;
  if (!!want.barren !== !!p.barren) d += 20;
  d += Math.abs(OCEAN_RANK[want.oceans] - OCEAN_RANK[p.oceans]) * 4;
  if (want.greenery !== p.greenery) d += 2.5;
  if (want.cities !== p.cities) d += 1.5;
  if (want.warmth !== p.warmth) d += 1;
  if (want.view !== p.view) d += 0.75;
  return d;
}

/** The library painting that best fits a finished game (ties broken by file name, so it is stable). */
const ICE_PAINTING = 'barren-ice';

export function matchPainting(f: PosterFacts, library: Painting[]): Painting | null {
  if (!library.length) return null;
  const want = wantedAxes(f);
  // The ice canyon shares its axes with the barren surface view: it is chosen only by its own rule,
  // for games that stayed cold and dry (one in three of them, so the surface view is seen too).
  const ice = library.find((p) => p.file === ICE_PAINTING);
  if (want.barren && ice && f.temperature <= -20 && f.oceans <= 1 && hashOf(f.gameId) % 3 === 0) return ice;
  const pool = library.filter((p) => p.file !== ICE_PAINTING);
  return [...(pool.length ? pool : library)].sort((a, b) => paintingDistance(want, a) - paintingDistance(want, b) || a.file.localeCompare(b.file))[0];
}

// ---- the optional one-off illustration --------------------------------------------------------
/** A prompt for the shared Forge (anima), built from the finished game, in the app's painterly style. */
export function uniquePrompt(f: PosterFacts): string {
  const want = wantedAxes(f);
  const winner = f.players.find((p) => p.placement === 1);
  const seas = want.barren ? 'frozen dust plains with a few meltwater streams'
    : want.oceans === 'full' ? 'deep blue seas filling the northern lowlands and the great basins'
      : want.oceans === 'mid' ? 'several blue lakes and young seas in the lowland craters' : 'a handful of small blue crater lakes';
  const life = want.greenery === 'lush' ? 'dense green forests and grasslands along every shore' : 'thin patches of lichen and young green fields';
  const towns = want.cities === 'dense' ? 'many glowing domed cities connected by roads' : 'a few small domed settlements';
  const sky = want.warmth === 'warm' ? 'a breathable blue-violet dusk sky with soft clouds' : 'a cold thin rust sky with polar ice';
  const view = want.view === 'orbit' ? 'a terraformed Mars seen from low orbit' : 'a wide vista across a terraformed Martian valley';
  const corp = winner?.corporation && winner.corporation !== 'Beginner Corporation' ? `, a monument of ${winner.corporation} on the horizon` : '';
  return `<lora:anima-turbo-lora-v0.2:0.5> cinematic painterly matte painting of ${view}, ${seas}, ${life}, ${towns}, ${sky}${corp}, `
    + 'oxide rust and deep indigo palette, volumetric haze, soft rim light, realistic science fiction, calm open sky in the upper third, '
    + 'no text, no letters, no logo, no border';
}

// ---- status sent to devices -------------------------------------------------------------------
export type PosterVariantState = 'off' | 'pending' | 'ready' | 'skipped' | 'failed';
export type PosterStatus = {
  gameId: string;
  /** the library poster; 'failed' only if composition itself failed (phones then show a styled card) */
  library: 'pending' | 'ready' | 'failed';
  /** the one-off illustration variant */
  unique: PosterVariantState;
  /** bumps whenever the files change (scores corrected), for cache busting */
  version: number;
  /** which library painting was used */
  painting: string | null;
};

export const POSTER_VARIANTS = ['library', 'unique'] as const;
export type PosterVariant = typeof POSTER_VARIANTS[number];
export const POSTER_ORIENTATIONS = ['landscape', 'portrait'] as const;
export type PosterOrientation = typeof POSTER_ORIENTATIONS[number];

export function posterUrl(s: Pick<PosterStatus, 'gameId' | 'version'>, variant: PosterVariant, orientation: PosterOrientation | 'thumb'): string {
  const o = orientation === 'thumb' ? 'landscape&size=thumb' : orientation;
  return `/api/poster/${encodeURIComponent(s.gameId)}.png?variant=${variant}&orientation=${o}&v=${s.version}`;
}
