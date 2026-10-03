// Phase 4 began for a moment on this TV: tell the server once (phone haptics are timed to it). A moment that restarts
// (a cinematic took the screen mid-way) does not send twice.
import {useNet} from '../../../net';
import type {Color} from '../../../../shared/full';

const sent = new Set<string>();

export function sendResolve(key: string, gameAge: number, attacker: string, targets: Color[]) {
  if (sent.has(key)) return;
  sent.add(key);
  if (sent.size > 400) sent.delete(sent.values().next().value as string);
  const m = {gameAge, attacker: attacker as Color, targets, at: Date.now()};
  // test hook: every resolve this TV sent
  const w = window as unknown as {__tvMoments?: unknown[]};
  w.__tvMoments = [...(w.__tvMoments ?? []).slice(-49), m];
  useNet.getState().tvMoment(m);
}
