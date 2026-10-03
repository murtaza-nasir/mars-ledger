// The solo game's facts (generation limit, result) from this device's view of the engine, or null in a game
// with more than one player.
import {soloStatus} from '../../shared/solo';
import type {SoloStatus} from '../../shared/solo';
import {useNet} from '../net';

export function useSolo(): SoloStatus | null {
  const view = useNet((s) => s.fullView);
  if (!view) return null;
  return soloStatus(view.model.players.length, view.model.game);
}
