// The TV radio: a YouTube playlist, played on the TV through YouTube's own embedded player.
// Shared by the TV (which plays and reports), the server (which relays and rate-limits) and the phones (a small
// remote in the game menu). The radio exists only when the server sets RADIO_PLAYLIST; there is no default.

/** A YouTube playlist id as it appears after `list=` in a playlist URL; null for anything else. */
export function playlistId(x: unknown): string | null {
  const v = typeof x === 'string' ? x.trim() : '';
  return /^[A-Za-z0-9_-]{10,64}$/.test(v) ? v : null;
}

/** Transport (`toggle` play/pause, `next`, `prev`) and the TV's Radio switch (`on`, `off`). */
export type RadioAction = 'toggle' | 'next' | 'prev' | 'on' | 'off';
export const RADIO_ACTIONS: RadioAction[] = ['toggle', 'next', 'prev', 'on', 'off'];
export const isSwitchAction = (a: RadioAction) => a === 'on' || a === 'off';
export const isRadioAction = (x: unknown): x is RadioAction => RADIO_ACTIONS.includes(x as RadioAction);

/** What the TV is playing, as it reports it (phones show it in their remote). */
export type RadioNow = {
  /** the TV's Radio switch is on (the music may still be waiting for the game to start) */
  enabled: boolean;
  /** the radio is switched on at the TV and its player works */
  on: boolean;
  playing: boolean;
  videoId: string | null;
  /** position in the playlist (0-based) */
  index: number;
  title: string;
  artist: string;
  /** the game the track comes from, when known */
  game: string | null;
};

/** A track's display facts, from YouTube's title and channel name. */
export type TrackInfo = {title: string; artist: string; game: string | null};

/**
 * Composers in the playlist whose albums are each one game's soundtrack. Titles from these YouTube
 * "Topic" channels name only the piece, so the game comes from the composer.
 */
const COMPOSER_GAME: Record<string, string> = {
  'George Strezov': 'Surviving Mars',
  'Christopher Tin': 'Offworld Trading Company',
  'Andreas Waldetoft': 'Stellaris',
};

/**
 * Split a YouTube title and channel into title, artist and source game.
 * "Alpha Centauri (From Stellaris Original Game Soundtrack)" by "Andreas Waldetoft - Topic"
 * → {title: "Alpha Centauri", artist: "Andreas Waldetoft", game: "Stellaris"}.
 */
export function trackInfo(rawTitle: string, rawAuthor: string): TrackInfo {
  let title = (rawTitle ?? '').trim();
  const artist = (rawAuthor ?? '').replace(/\s*-\s*Topic$/i, '').trim();
  let game: string | null = null;
  // "(From X Original Game Soundtrack)", "(From "X")", "[X OST]"
  const from = /\s*[([]\s*from\s+["“]?(.+?)["”]?(?:\s+(?:original\s+)?(?:game\s+)?(?:soundtrack|ost))?\s*[)\]]\s*$/i.exec(title);
  if (from) {
    game = from[1].trim();
    title = title.slice(0, from.index).trim();
  } else {
    const ost = /\s*[([]\s*(.+?)\s+(?:original\s+)?(?:game\s+)?(?:soundtrack|ost)\s*[)\]]\s*$/i.exec(title);
    if (ost) {
      game = ost[1].trim();
      title = title.slice(0, ost.index).trim();
    } else {
      // "Stellaris OST - Alpha Centauri" / "Stellaris Soundtrack - Alpha Centauri"
      const lead = /^(.+?)\s+(?:original\s+)?(?:game\s+)?(?:soundtrack|ost)\s*[-–—:|]\s*(.+)$/i.exec(title);
      if (lead) { game = lead[1].trim(); title = lead[2].trim(); }
    }
  }
  game ??= COMPOSER_GAME[artist] ?? null;
  return {title: title || rawTitle || 'Unknown track', artist, game};
}

/** The track's still, from YouTube's image server. */
export const thumbnailUrl = (videoId: string, size: 'hq' | 'mq' = 'hq') => `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/${size}default.jpg`;

// ---- the phones' remote: rate limits -------------------------------------------------------------
/** A phone may press the radio remote this often per window (one person tapping fast still gets through). */
export const RADIO_PLAYER_LIMIT = 5;
export const RADIO_PLAYER_WINDOW_MS = 10_000;
/** The whole table together, so several phones cannot flood the TV. */
export const RADIO_TABLE_LIMIT = 10;
export const RADIO_TABLE_WINDOW_MS = 10_000;
