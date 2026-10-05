// Player names: one source of truth. A seat's display name is our own player record (state.players[].name), which a
// profile edit on the phone renames. The engine keeps the name each player had when the full game was created and has
// no way to change it, so every engine model, log line, story and notice is resolved through the seat's colour or
// playerId at the moment it is shown; engine names are only a fallback for seats we do not know.
import type {GameState} from './game';
import type {Color, GameModel, PublicPlayerModel} from './full';
import type {GameHistory} from './history';
import type {Notice, NoticeFeed} from './notices';

/** Every seat's current display name, by playerId and by the colour the seat plays in (the engine's colour in full games). */
export type SeatNames = {byId: Record<string, string>; byColor: Record<string, string>};

export const NO_NAMES: SeatNames = {byId: {}, byColor: {}};

export function seatNames(state: Pick<GameState, 'players' | 'mode' | 'full'> | null | undefined): SeatNames {
  if (!state) return NO_NAMES;
  const byId: Record<string, string> = {};
  const byColor: Record<string, string> = {};
  for (const p of state.players) {
    byId[p.id] = p.name;
    const color = (state.mode === 'full' ? state.full?.players[p.id]?.color : undefined) ?? p.color;
    byColor[color] = p.name;
  }
  return {byId, byColor};
}

/** A stable signature of the names (a change means a seat was renamed). */
export function namesKey(n: SeatNames): string {
  return Object.entries(n.byColor).sort(([a], [b]) => a.localeCompare(b)).map(([c, name]) => `${c}:${name}`).join('|') + '#' +
    Object.entries(n.byId).sort(([a], [b]) => a.localeCompare(b)).map(([id, name]) => `${id}:${name}`).join('|');
}

/**
 * The name to show for a seat, given its playerId or colour. `fallback` (usually the engine's name) is used only when
 * the seat is not ours; with neither, the key itself.
 */
export function displayName(n: SeatNames, key: string | null | undefined, fallback?: string | null): string {
  if (!key) return fallback ?? '';
  return n.byId[key] ?? n.byColor[key] ?? fallback ?? key;
}

/** A resolver bound to the names: `nameFor('red')`, `nameFor(playerId, engineName)`. */
export function nameResolver(n: SeatNames): (key: string | null | undefined, fallback?: string | null) => string {
  return (key, fallback) => displayName(n, key, fallback);
}

// ---- relabelling: structured data keeps colours; the names in it are re-read from the seats ----------------------------
// Each function returns its input unchanged (the same object) when no name differs, so stores and memos see no change.

function relabelPlayer<P extends {color: Color | string; name: string}>(p: P, n: SeatNames): P {
  const name = n.byColor[p.color];
  return name && name !== p.name ? {...p, name} : p;
}

function relabelList<P extends {color: Color | string; name: string}>(list: P[], n: SeatNames): P[] {
  let changed = false;
  const out = list.map((p) => { const q = relabelPlayer(p, n); if (q !== p) changed = true; return q; });
  return changed ? out : list;
}

function relabelClaims<T extends {color?: Color; playerName?: string}>(list: T[] | undefined, n: SeatNames): T[] | undefined {
  if (!list) return list;
  let changed = false;
  const out = list.map((m) => {
    const name = m.color ? n.byColor[m.color] : undefined;
    if (!name || name === m.playerName || m.playerName === undefined) return m;
    changed = true;
    return {...m, playerName: name};
  });
  return changed ? out : list;
}

/** An engine model (player view or spectator) with every player name, and the milestone/award owners, from our seats. */
export function relabelModel<M extends {players: PublicPlayerModel[]; game: GameModel; thisPlayer?: PublicPlayerModel}>(m: M, n: SeatNames): M {
  if (!m || !Array.isArray(m.players)) return m;
  const players = relabelList(m.players, n);
  const thisPlayer = m.thisPlayer ? relabelPlayer(m.thisPlayer, n) : m.thisPlayer;
  const milestones = relabelClaims(m.game?.milestones, n);
  const awards = relabelClaims(m.game?.awards, n);
  if (players === m.players && thisPlayer === m.thisPlayer && milestones === m.game?.milestones && awards === m.game?.awards) return m;
  return {...m, players, ...(m.thisPlayer ? {thisPlayer} : {}),
    game: {...m.game, ...(milestones ? {milestones} : {}), ...(awards ? {awards} : {})}};
}

/** A full view: its model, and the last move's name (by playerId). */
export function relabelView<V extends {model: {players: PublicPlayerModel[]; game: GameModel; thisPlayer?: PublicPlayerModel}; lastMove?: {playerId: string; name: string} | null}>(v: V, n: SeatNames): V {
  if (!v) return v;
  const model = relabelModel(v.model, n);
  const lm = v.lastMove;
  const lastName = lm ? n.byId[lm.playerId] : undefined;
  const lastMove = lm && lastName && lastName !== lm.name ? {...lm, name: lastName} : lm;
  if (model === v.model && lastMove === lm) return v;
  return {...v, model, ...(lm !== undefined ? {lastMove} : {})};
}

/** The story of a game: the player list keeps colours; its names are the seats' current names. */
export function relabelHistory<H extends Pick<GameHistory, 'players'>>(h: H, n: SeatNames): H;
export function relabelHistory<H extends Pick<GameHistory, 'players'>>(h: H | null, n: SeatNames): H | null;
export function relabelHistory<H extends Pick<GameHistory, 'players'>>(h: H | null, n: SeatNames): H | null {
  if (!h) return h;
  const players = relabelList(h.players, n);
  return players === h.players ? h : {...h, players};
}

/** A notice names who did it by colour (`by`); `byName` is the name stored when it was seen, used only as a fallback. */
export function relabelNotice(x: Notice, n: SeatNames): Notice {
  const name = x.by ? n.byColor[x.by] : undefined;
  return name && x.byName !== null && name !== x.byName ? {...x, byName: name} : x;
}

export function relabelFeed(f: NoticeFeed, n: SeatNames): NoticeFeed {
  if (!f) return f;
  let changed = false;
  const notices = f.notices.map((x) => { const y = relabelNotice(x, n); if (y !== x) changed = true; return y; });
  return changed ? {...f, notices} : f;
}

/** Anything naming one seat by playerId (undo notices, the last move, a production show row). */
export function relabelById<T extends {playerId: string | null; name: string}>(x: T, n: SeatNames): T;
export function relabelById<T extends {playerId: string | null; name: string}>(x: T | null, n: SeatNames): T | null;
export function relabelById<T extends {playerId: string | null; name: string}>(x: T | null, n: SeatNames): T | null {
  if (!x) return x;
  const name = (x.playerId ? n.byId[x.playerId] : undefined) ?? ('color' in x && typeof x.color === 'string' ? n.byColor[x.color] : undefined);
  return name && name !== x.name ? {...x, name} : x;
}

/** A production show's rows. */
export function relabelRows<S extends {players: Array<{playerId: string | null; name: string; color: Color}>}>(s: S, n: SeatNames): S {
  let changed = false;
  const players = s.players.map((p) => { const q = relabelById(p, n); if (q !== p) changed = true; return q; });
  return changed ? {...s, players} : s;
}
