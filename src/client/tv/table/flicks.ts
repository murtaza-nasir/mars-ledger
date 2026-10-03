// Cards flicked from phones are shown by the flick layer; the regular card moment for the same play
// checks here and stands aside so a card is never announced twice.
import {useNet} from '../../net';

const WINDOW_MS = 30_000;

export function wasFlicked(color: string, card: string): boolean {
  const {flicks, cancelledFlicks} = useNet.getState();
  const now = Date.now();
  return flicks.some((f) => f.color === color && f.card === card && now - f.at < WINDOW_MS && !cancelledFlicks.includes(f.id));
}

/** The on-screen rectangle of a player's strip, if the current TV layout shows one. */
export function stripRect(color: string): DOMRect | null {
  const el = document.querySelector(`[data-strip-color="${color}"]`);
  return el ? el.getBoundingClientRect() : null;
}
