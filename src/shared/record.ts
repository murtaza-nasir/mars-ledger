// Turn a finished game into result rows: companion games from our own engine state and command log,
// full games from the engine's final spectator model and the story the server kept.
import {score, gameShouldEnd} from './engine';
import {findCard} from './cards';
import {companionHistory} from './history';
import type {GameHistory} from './history';
import type {GameState, Tick} from './game';
import type {SpectatorModel} from './full';
import {buildResults, placements} from './profiles';
import type {GameResult, RecentGame} from './profiles';

export type Recording = {game: RecentGame; results: GameResult[]; seats: Array<{profileId: string; playerId: string | null; name: string; color: string}>};

/** Companion: scores include the board points players entered on the final screen. */
export function recordCompanion(state: GameState, ticks: Tick[], endedAt = state.endedAt ?? Date.now()): Recording {
  const history = companionHistory(state, ticks);
  const all = state.players.map((p) => ({p, vp: score(state, p).total}));
  const place = placements(all.map((x) => x.vp));
  const game: RecentGame = {
    gameId: state.id, endedAt, mode: 'companion', board: state.board ?? 'tharsis', generations: state.generation,
    players: all.map((x, i) => ({profileId: x.p.profileId ?? null, name: x.p.name, color: x.p.color, vp: x.vp, placement: place[i]}))
      .sort((a, b) => a.placement - b.placement || b.vp - a.vp),
  };
  const seated = all.filter((x) => x.p.profileId);
  const results = buildResults({
    gameId: state.id, endedAt, mode: 'companion', board: state.board ?? 'tharsis', generations: state.generation,
    terraformed: gameShouldEnd(state), history,
    allScores: all.map((x) => ({color: x.p.color, vp: x.vp})),
    seats: seated.map((x) => ({profileId: x.p.profileId!, name: x.p.name, color: x.p.color, vp: x.vp,
      corporations: x.p.corporation ? [x.p.corporation] : [], beginner: x.p.corporation === 'Beginner Corporation'})),
  });
  return {game, results, seats: seated.map((x) => ({profileId: x.p.profileId!, playerId: x.p.id, name: x.p.name, color: x.p.color}))};
}

/** Full: the engine's final breakdown; seats map engine colours back to lobby players. */
export function recordFull(state: GameState, final: SpectatorModel, history: GameHistory | null, endedAt = Date.now()): Recording {
  const link = state.full;
  const byColor = new Map(Object.entries(link?.players ?? {}).map(([playerId, seat]) => [seat.color as string, playerId]));
  const all = final.players.map((ep) => {
    const playerId = byColor.get(ep.color) ?? null;
    const lobby = playerId ? state.players.find((p) => p.id === playerId) : undefined;
    const corporations = ep.tableau.map((c) => c.name).filter((n) => findCard(n)?.group === 'corporation');
    return {ep, playerId, lobby, vp: ep.victoryPointsBreakdown?.total ?? ep.terraformRating, corporations};
  });
  const place = placements(all.map((x) => x.vp));
  const g = final.game;
  const terraformed = g.isTerraformed || (g.temperature >= 8 && g.oxygenLevel >= 14 && g.oceans >= 9);
  const game: RecentGame = {
    gameId: link?.gameId ?? state.id, endedAt, mode: 'full', board: state.board ?? 'tharsis', generations: g.generation,
    players: all.map((x, i) => ({profileId: x.lobby?.profileId ?? null, name: x.lobby?.name ?? x.ep.name, color: x.ep.color, vp: x.vp, placement: place[i]}))
      .sort((a, b) => a.placement - b.placement || b.vp - a.vp),
  };
  const seated = all.filter((x) => x.lobby?.profileId);
  const results = buildResults({
    gameId: game.gameId, endedAt, mode: 'full', board: state.board ?? 'tharsis', generations: g.generation, terraformed, history,
    allScores: all.map((x) => ({color: x.ep.color, vp: x.vp})),
    seats: seated.map((x) => ({profileId: x.lobby!.profileId!, name: x.lobby!.name, color: x.ep.color, vp: x.vp, corporations: x.corporations,
      beginner: !!x.lobby!.beginner || x.corporations.includes('Beginner Corporation')})),
  });
  return {game, results, seats: seated.map((x) => ({profileId: x.lobby!.profileId!, playerId: x.playerId, name: x.lobby!.name, color: x.ep.color}))};
}
