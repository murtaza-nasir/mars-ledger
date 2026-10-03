// Phone-to-TV links, server side (rules in src/shared/tvlinks.ts): checks a phone's replay or map echo and turns it
// into the message the TVs get; times each hit's buzz to the TV's resolve. Socket-free, so tests drive it directly.
import type {Color} from '../shared/full';
import type {GameState} from '../shared/game';
import type {Notice} from '../shared/notices';
import {cleanTargets, EchoLimiter, HapticRelay, HIT_PATTERN, HIT_PATTERN_PLAIN, ReplayDesk} from '../shared/tvlinks';
import type {Buzz, Echo, HapticHit, Replay, ReplayMove, TvMoment} from '../shared/tvlinks';

export type LinkVerdict<T> = {ok: true; out: T} | {ok: false; error: string};

const COLORS = ['red', 'green', 'blue', 'yellow', 'black', 'purple', 'orange', 'pink', 'bronze'];

/** A replay request as it may arrive from a phone, cut down to what the TV uses. */
export function cleanMove(raw: unknown): ReplayMove | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  if (!COLORS.includes(String(m.by)) || typeof m.how !== 'string') return null;
  const card = typeof m.card === 'string' ? m.card.slice(0, 80) : null;
  const str = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : undefined);
  const targets = Array.isArray(m.targets) ? m.targets.slice(0, 5).flatMap((t) => {
    const x = t as {color?: unknown; losses?: unknown};
    if (!COLORS.includes(String(x?.color)) || !Array.isArray(x.losses)) return [];
    const losses = x.losses.slice(0, 6).flatMap((l) => {
      const y = l as Record<string, unknown>;
      if (!['stock', 'production', 'tr', 'card'].includes(String(y?.what)) || !Number.isFinite(Number(y.amount))) return [];
      return [{what: y.what as 'stock', amount: Math.max(0, Math.min(99, Number(y.amount))), ...(str(y.resource, 20) ? {resource: str(y.resource, 20)} : {}),
        ...(str(y.card, 80) ? {card: str(y.card, 80)} : {})}];
    });
    return [{color: x.color as Color, losses}];
  }) : undefined;
  const RES = ['megacredits', 'steel', 'titanium', 'plants', 'energy', 'heat'];
  const gains = Array.isArray(m.gains) ? m.gains.slice(0, 8).flatMap((g) => {
    const x = g as {r?: unknown; n?: unknown; prod?: unknown};
    const n = Number(x?.n);
    return RES.includes(String(x?.r)) && Number.isFinite(n) && n > 0 ? [{r: x.r as 'plants', n: Math.min(99, Math.round(n)), prod: !!x.prod}] : [];
  }) : undefined;
  const spaceId = typeof m.spaceId === 'string' && /^[0-9]{2,3}$/.test(m.spaceId) ? m.spaceId : undefined;
  const cards = Array.isArray(m.cards) ? m.cards.filter((c): c is string => typeof c === 'string').slice(0, 3).map((c) => c.slice(0, 80)) : undefined;
  // something to show: a card, or a space to point at
  if (!card && !spaceId) return null;
  return {key: str(m.key, 300) ?? '', by: m.by as Color, how: m.how.slice(0, 20), card,
    ...(cards?.length ? {cards} : {}), ...(str(m.line, 240) ? {line: str(m.line, 240)} : {}), ...(targets?.length ? {targets} : {}),
    ...(gains?.length ? {gains} : {}), ...(spaceId ? {spaceId} : {})};
}

export class TvLinkDesk {
  readonly replays = new ReplayDesk();
  readonly echoes = new EchoLimiter();
  readonly haptics = new HapticRelay();
  private seq = 0;

  /** Who may ask: a seated person in a running full game, from their own phone, with a TV to show it on. */
  private asker(state: GameState, speaker: string | null, playerId: unknown, tvs: number): {ok: true; who: {id: string; name: string; color: Color}} | {ok: false; error: string} {
    const p = state.players.find((x) => x.id === playerId);
    if (!p || p.bot) return {ok: false, error: 'Only players at the table can do that'};
    if (speaker !== p.id) return {ok: false, error: 'A phone can only ask for its own player'};
    if (state.mode !== 'full' || state.phase === 'lobby' || !state.full) return {ok: false, error: 'This works once the game is running'};
    if (tvs <= 0) return {ok: false, error: 'No TV is connected'};
    const color = (state.full.players[p.id]?.color ?? p.color) as Color;
    return {ok: true, who: {id: p.id, name: p.name, color}};
  }

  replay(state: GameState, speaker: string | null, msg: {playerId: string; move: unknown}, now: number, tvs: number): LinkVerdict<Replay> {
    const a = this.asker(state, speaker, msg.playerId, tvs);
    if (!a.ok) return a;
    const move = cleanMove(msg.move);
    if (!move) return {ok: false, error: 'That move cannot be shown on the TV'};
    const v = this.replays.judge(a.who.id, now);
    if (!v.ok) return v;
    const id = `rp${now.toString(36)}-${++this.seq}`;
    this.replays.start(a.who.id, id, now);
    return {ok: true, out: {id, from: a.who, move, at: now}};
  }

  replayDone(id: unknown, now: number) {
    if (typeof id === 'string') this.replays.done(id, now);
  }

  echo(state: GameState, speaker: string | null, msg: {playerId: string; targets: unknown}, now: number, tvs: number): LinkVerdict<Echo> {
    const a = this.asker(state, speaker, msg.playerId, tvs);
    if (!a.ok) return a;
    const targets = cleanTargets(msg.targets);
    if (!targets.length) return {ok: false, error: 'Nothing to show on the TV for that move'};
    const v = this.echoes.take(a.who.id, now);
    if (!v.ok) return v;
    return {ok: true, out: {id: `ec${now.toString(36)}-${++this.seq}`, from: a.who, targets, at: now}};
  }

  /** New hit notices for `seat` (colour `color`): what to buzz now (no TV), or nothing until the TV resolves them. */
  hits(seat: string, color: Color, fresh: Notice[], now: number, tvs: number): Buzz[] {
    return fresh.filter((n) => n.kind === 'hit').flatMap((n) => this.haptics.notice({seat, color, attacker: n.by, age: n.age}, now, tvs));
  }

  /** The (primary) TV reached a moment's resolution: the hit seats to buzz now. Moments that hurt nobody change nothing. */
  moment(raw: unknown, now: number): Buzz[] {
    const m = raw as Partial<TvMoment>;
    if (!m || m.phase !== 'resolve' || !Number.isFinite(m.gameAge) || !COLORS.includes(String(m.attacker)) || !Array.isArray(m.targets)) return [];
    const targets = m.targets.filter((c): c is Color => COLORS.includes(String(c)));
    if (!targets.length) return [];
    return this.haptics.moment({phase: 'resolve', gameAge: m.gameAge!, attacker: m.attacker as Color, targets, at: Number(m.at) || now}, now);
  }

  tick(now: number): Buzz[] { return this.haptics.tick(now); }

  /** An undo or a new game. */
  reset() { this.haptics.reset(); }
}

/** The message a buzzed phone gets. */
export const hapticFor = (b: Buzz): HapticHit => ({attacker: b.attacker, synced: b.synced, pattern: b.synced ? HIT_PATTERN : HIT_PATTERN_PLAIN});
