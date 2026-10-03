// The radio's live status on this TV, shared by the player, the options panel and the test handle.
import {create} from 'zustand';
import type {TrackInfo} from '../../../shared/radio';

export type RadioStatus =
  /** switched off, or no game on */
  | 'idle'
  /** loading YouTube or the playlist */
  | 'loading'
  /** the player works (playing, paused or waiting for the first tap) */
  | 'ready'
  /** YouTube or the playlist would not play: the radio steps aside and the options say why */
  | 'unavailable';

export type Track = TrackInfo & {videoId: string; index: number};

type Radio = {
  status: RadioStatus;
  /** why the radio is unavailable, for the options panel */
  notice: string | null;
  track: Track | null;
  playing: boolean;
  /** the browser has not let the music start yet: the next tap or key starts it */
  needsGesture: boolean;
  /** 0..1 through the current track */
  progress: number;
  /** tracks skipped as unplayable this session */
  skipped: number;
  /** full game: the deck's right edge in CSS px (the log ticker starts after it); null when the deck is not up */
  deckRight: number | null;
  set: (p: Partial<Omit<Radio, 'set'>>) => void;
};

export const useRadio = create<Radio>((set) => ({
  status: 'idle', notice: null, track: null, playing: false, needsGesture: false, progress: 0, skipped: 0, deckRight: null,
  set: (p) => set(p),
}));

/** The options panel's note under the Radio switch (null: nothing to say). */
export function useRadioNotice(): string | null {
  return useRadio((s) => (s.status === 'unavailable' ? s.notice ?? 'The playlist would not play' : s.skipped > 0 ? `Skipped ${s.skipped} unplayable track${s.skipped === 1 ? '' : 's'}` : null));
}
