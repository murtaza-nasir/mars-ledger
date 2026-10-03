// A TV's move presentation reached Phase 4 (effects resolving): the TV says so with a 'tvMoment' message, so phone
// haptics can be timed to what the table sees. Every TV sends its own; only the first-connected TV's count (two TVs
// would otherwise buzz a phone twice). Pure apart from the handler, which the haptics work extends.
import type {Color} from '../shared/full';
import type {TvMomentMsg} from '../shared/protocol';

const COLORS: ReadonlySet<string> = new Set<Color>(['red', 'green', 'blue', 'yellow', 'black', 'purple', 'orange', 'pink', 'neutral', 'bronze']);

/** The message cleaned up, or null when it is malformed. */
export function readTvMoment(raw: unknown): TvMomentMsg | null {
  const m = raw as Partial<TvMomentMsg> | null;
  if (!m || m.type !== 'tvMoment' || m.phase !== 'resolve') return null;
  if (typeof m.gameAge !== 'number' || !Number.isFinite(m.gameAge)) return null;
  if (typeof m.attacker !== 'string' || !COLORS.has(m.attacker)) return null;
  if (!Array.isArray(m.targets)) return null;
  const targets = [...new Set(m.targets.filter((t): t is Color => typeof t === 'string' && COLORS.has(t) && t !== m.attacker))].slice(0, 8);
  const at = typeof m.at === 'number' && Number.isFinite(m.at) ? m.at : Date.now();
  return {type: 'tvMoment', phase: 'resolve', gameAge: m.gameAge, attacker: m.attacker, targets, at};
}

/** The TV whose moments count: the first-connected TV socket still open (sockets in connection order). */
export function primaryTv<S>(socketsInOrder: Iterable<S>, isTv: (s: S) => boolean): S | null {
  for (const s of socketsInOrder) if (isTv(s)) return s;
  return null;
}

/**
 * Called once per moment the primary TV resolves. A no-op for now: phone haptics hook in here (send a buzz to the
 * targets' phones, and a lighter one to the attacker's).
 */
export function handleTvMoment(m: TvMomentMsg): void {
  void m;
}
