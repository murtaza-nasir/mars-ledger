// Keeps the full-mode story (src/shared/history.ts) for the linked engine game: folds every observed
// spectator model into it, persists it in SQLite, and says when it is worth broadcasting.
// An undo takes the game back to an earlier moment; the story goes back with it (to a copy kept when that moment
// was first seen), so a move that was undone and played again is not counted twice.
import {closeGeneration, newHistory, observeFull} from '../../shared/history';
import type {GameHistory} from '../../shared/history';
import type {Color, SpectatorModel} from '../../shared/full';

/** How many earlier moments (distinct gameAges) are kept for undo; the engine only undoes within one turn. */
const SNAPSHOTS = 40;

export type HistoryStore = {loadHistory(id: string): GameHistory | null; saveHistory(id: string, h: GameHistory): void};

export class HistoryKeeper {
  private h: GameHistory | null = null;
  private dirty = false;
  private timer: NodeJS.Timeout | null = null;
  /** The story as it stood when each gameAge was first observed (oldest first), for the current game. */
  private snaps: Array<{age: number; json: string}> = [];

  constructor(private store: HistoryStore) {}

  get(gameId: string): GameHistory {
    if (this.h?.id !== gameId) {
      this.flush();
      this.h = this.store.loadHistory(gameId) ?? newHistory(gameId, 'full');
      this.snaps = [];
    }
    return this.h;
  }

  /** Returns true when the change matters to the TV (a generation closed, the game ended, first sight). */
  observe(gameId: string, prev: SpectatorModel | null, next: SpectatorModel): boolean {
    const h = this.get(gameId);
    const r = observeFull(h, prev, next);
    const last = this.snaps.at(-1);
    if (!last || last.age !== next.game.gameAge) {
      this.snaps.push({age: next.game.gameAge, json: JSON.stringify(h)});
      if (this.snaps.length > SNAPSHOTS) this.snaps.shift();
    }
    if (!r.changed) return false;
    const important = r.closed !== undefined || !!r.ended || !prev;
    this.save(important);
    return important;
  }

  /**
   * The engine went back to `to` (an undo): the story returns to the copy kept when that gameAge was first seen (or the
   * newest earlier one), so whatever the undone move added (tiles, cards, TR, M€ spent, attacks) is gone. The undo itself
   * is noted in `undos`. Returns false when no copy is old enough (e.g. after a server restart): the story then stays.
   */
  rewind(gameId: string, to: SpectatorModel, by: Color | null): boolean {
    const h = this.get(gameId);
    const age = to.game.gameAge;
    let i = this.snaps.findIndex((x) => x.age === age);
    if (i < 0) i = this.snaps.findLastIndex((x) => x.age < age);
    const undos = [...(h.undos ?? []), ...(by ? [{generation: to.game.generation, color: by}] : [])];
    if (i < 0) {
      console.warn(`history: no copy of the story at gameAge ${age} to go back to; it keeps the undone move`);
      h.undos = undos;
      this.save(true);
      return false;
    }
    this.h = {...JSON.parse(this.snaps[i].json) as GameHistory, undos};
    this.snaps = this.snaps.slice(0, i + 1);
    this.save(true);
    return true;
  }

  /** The game's last production (it does not advance the generation). */
  closeFinal(gameId: string, pre: SpectatorModel): boolean {
    const g = closeGeneration(this.get(gameId), pre);
    if (g === null) return false;
    this.save(true);
    return true;
  }

  private save(now: boolean) {
    this.dirty = true;
    if (now) return this.flush();
    this.timer ??= setTimeout(() => this.flush(), 2000);
  }

  flush() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (!this.dirty || !this.h) return;
    this.dirty = false;
    try { this.store.saveHistory(this.h.id, this.h); } catch (e) { console.warn('history: save failed:', (e as Error).message); }
  }
}
