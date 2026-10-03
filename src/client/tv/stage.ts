// What is on the TV's stage right now, for layers that must wait their turn (mission control's
// captions wait for companion moments and flicked cards; cinematics and the production show have
// their own signals).
import {create} from 'zustand';

type Stage = {
  /** a companion-mode full-screen moment is showing */
  moment: boolean;
  /** a card flicked from a phone is on screen */
  flick: boolean;
  /** the end-of-game story is playing an animated chapter (its podium does not count) */
  story: boolean;
  /** mission control's caption is on screen (the log ticker steps back under it) */
  caption: boolean;
  /** the end-of-game story has reached its podium, which holds until the next game */
  podium: boolean;
  /** when the end-of-game story appeared (reactions keep quiet in its first second) */
  storyStartedAt: number | null;
  set: (k: 'moment' | 'flick' | 'story' | 'caption' | 'podium', v: boolean) => void;
  setStoryStartedAt: (t: number | null) => void;
};

export const useStage = create<Stage>((set) => ({
  moment: false,
  flick: false,
  story: false,
  caption: false,
  podium: false,
  storyStartedAt: null,
  set: (k, v) => set({[k]: v} as Partial<Stage>),
  setStoryStartedAt: (t) => set({storyStartedAt: t}),
}));
