// The radio's place in the TV's mix, as a tiny API other layers call without knowing about YouTube:
//   radioMix.duck('voice', DUCK_DEPTH.voice, ms)  lowers the music while mission control speaks;
//   radioMix.gate(settings)                        turns the background hum off while music plays.
// The radio itself reads `level()` every frame it glides, and reports `setPlaying`.
import {DuckDesk} from './logic';

type Listener = () => void;

class RadioMix {
  private desk = new DuckDesk();
  private listeners = new Set<Listener>();
  private _playing = false;
  /** a test handle can read what is holding the music down */
  get holds() { return this.desk.active; }

  /** Lower the music to `depth` for `ms` (the same key extends its hold). */
  duck(key: string, depth: number, ms: number) { this.desk.duck(key, depth, ms, now()); }
  /** Lower it until released. */
  hold(key: string, depth: number) { this.desk.hold(key, depth); }
  release(key: string) { this.desk.release(key); }
  level(): number { return this.desk.level(now()); }

  /** Is music audibly playing? (the hum steps aside while it is) */
  get playing() { return this._playing; }
  setPlaying(p: boolean) {
    if (p === this._playing) return;
    this._playing = p;
    for (const l of this.listeners) l();
  }
  subscribe(l: Listener) { this.listeners.add(l); return () => { this.listeners.delete(l); }; }

  /** The TV's sound settings as the mix should apply them: no background hum while the radio plays. */
  gate<T extends {hum: boolean}>(s: T): T { return this._playing && s.hum ? {...s, hum: false} : s; }
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export const radioMix = new RadioMix();
export {DUCK_DEPTH} from './logic';
