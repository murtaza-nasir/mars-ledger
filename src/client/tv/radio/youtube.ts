// YouTube's official IFrame Player API, loaded once from youtube.com (no audio is ever fetched or stored by us).
// Only the calls the radio uses are typed here.

export type YTPlayer = {
  playVideo(): void;
  pauseVideo(): void;
  stopVideo(): void;
  nextVideo(): void;
  previousVideo(): void;
  playVideoAt(index: number): void;
  loadPlaylist(o: {list: string; listType: 'playlist'; index?: number; startSeconds?: number}): void;
  cuePlaylist(o: {list: string; listType: 'playlist'; index?: number; startSeconds?: number}): void;
  setShuffle(on: boolean): void;
  setLoop(on: boolean): void;
  setVolume(v: number): void;
  getVolume(): number;
  mute(): void;
  unMute(): void;
  isMuted(): boolean;
  getPlayerState(): number;
  getCurrentTime(): number;
  getDuration(): number;
  getPlaylist(): string[] | null;
  getPlaylistIndex(): number;
  getVideoData(): {video_id?: string; title?: string; author?: string};
  getIframe(): HTMLIFrameElement;
  destroy(): void;
};

type YTNamespace = {
  Player: new (el: HTMLElement, o: {
    width: number | string; height: number | string; host?: string;
    playerVars: Record<string, string | number>;
    events: {
      onReady?: (e: {target: YTPlayer}) => void;
      onStateChange?: (e: {data: number; target: YTPlayer}) => void;
      onError?: (e: {data: number; target: YTPlayer}) => void;
      onAutoplayBlocked?: (e: {target: YTPlayer}) => void;
    };
  }) => YTPlayer;
  PlayerState: {UNSTARTED: -1; ENDED: 0; PLAYING: 1; PAUSED: 2; BUFFERING: 3; CUED: 5};
};

export const YT_STATE = {UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5} as const;

/**
 * youtube.com rather than youtube-nocookie.com: both play the playlist, but only youtube.com carries the TV
 * browser's YouTube sign-in, so a Premium account plays without ads.
 */
export const YT_HOST = 'https://www.youtube.com';
const API_URL = 'https://www.youtube.com/iframe_api';

let loading: Promise<YTNamespace> | null = null;

/** Load the API once; rejects when the script cannot load (offline, blocked) within `timeoutMs`. */
export function loadYouTube(timeoutMs = 15000): Promise<YTNamespace> {
  const w = window as unknown as {YT?: YTNamespace & {loaded?: number}; onYouTubeIframeAPIReady?: () => void};
  if (w.YT?.Player) return Promise.resolve(w.YT);
  if (loading) return loading;
  loading = new Promise<YTNamespace>((resolve, reject) => {
    const timer = window.setTimeout(() => fail(new Error('YouTube did not answer')), timeoutMs);
    const fail = (e: Error) => { window.clearTimeout(timer); loading = null; reject(e); };
    const prev = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => {
      prev?.();
      window.clearTimeout(timer);
      if (w.YT?.Player) resolve(w.YT); else fail(new Error('YouTube player unavailable'));
    };
    const s = document.createElement('script');
    s.src = API_URL;
    s.async = true;
    s.onerror = () => { s.remove(); fail(new Error('YouTube could not be reached')); };
    document.head.appendChild(s);
  });
  return loading;
}
