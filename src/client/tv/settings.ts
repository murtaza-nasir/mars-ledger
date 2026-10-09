// The TV's own options: volumes, the background hum, the radio, and how large the secondary text is.
// They belong to this screen, not the table, so they live in this browser's storage.
import {useSyncExternalStore} from 'react';
import {clampTilt, clampZoom} from './full/board3d/camera3d';

export type TextSize = 'normal' | 'large' | 'xl';
export const TEXT_SIZES: TextSize[] = ['normal', 'large', 'xl'];
export const TEXT_SIZE_LABEL: Record<TextSize, string> = {normal: 'Normal', large: 'Large', xl: 'Extra large'};
/** Factor applied to the TV's secondary text (the CSS variable --tvt). */
export const TEXT_SCALE: Record<TextSize, number> = {normal: 1, large: 1.15, xl: 1.3};

/** The 3D board's tile set: Classic (board3d/models/*.tsx) or Detailed (board3d/models/detailed/). */
export type TileStyle = 'classic' | 'detailed';
export const TILE_STYLES: TileStyle[] = ['classic', 'detailed'];
export const TILE_STYLE_LABEL: Record<TileStyle, string> = {classic: 'Classic', detailed: 'Detailed'};
/** What a screen draws until someone picks a style there: Detailed. A screen stores a style only once it is picked there, so this default reaches every other screen. */
export const DEFAULT_TILE_STYLE: TileStyle = 'detailed';
/** The tile style this screen draws. */
export function tileStyleOf(s: Pick<TvSettings, 'tileStyle'>): TileStyle { return s.tileStyle ?? DEFAULT_TILE_STYLE; }

/** Whether board life's characters run on this screen: both "Board life" and its "Terraformers" switch are on. */
export function terraformersOn(s: Pick<TvSettings, 'boardLife' | 'terraformers'>): boolean { return s.boardLife && s.terraformers; }

export type TvSettings = {
  /** 0..1 */
  master: number;
  /** the ambient wind and drone */
  hum: boolean;
  humVolume: number;
  effects: number;
  voice: number;
  textSize: TextSize;
  /** day and night across each generation, dust storms after attacks, late-game mist */
  weather: boolean;
  /** the 3D board; off = the flat board */
  board3d: boolean;
  /** the TR track: 100 numbered squares round the screen's edge with a token per player at their terraform rating (on by default) */
  trTrack: boolean;
  /** the camera moving toward placements and big moments (both boards) */
  cameraMoves: boolean;
  /** the 3D board's tile set, once picked on this screen; null follows DEFAULT_TILE_STYLE (tileStyleOf) */
  tileStyle: TileStyle | null;
  /** "Board life": tiny animated miniatures, things from the sky and ambient life on the 3D board's empty land (on by default) */
  boardLife: boolean;
  /** "Terraformers", under Board life: its two little characters, their vignettes and reactions (on by default). Board
   *  life is the master switch: off, nothing of it runs; on with Terraformers off, only the sky drops and the ambient
   *  rover, drone, dust devils and lichen run, and no character is built (terraformersOn) */
  terraformers: boolean;
  /** the TV radio: the server's YouTube playlist (RADIO_PLAYLIST) during a game; off until switched on here */
  radio: boolean;
  radioVolume: number;
  // ---- experimental (TV options, "Experimental" group): each off restores the usual behaviour exactly ----
  /** the resting 3D board's zoom and tilt follow the sliders below */
  boardView: boolean;
  /** the board's size against the automatic framing (0.8 to 1.4); null: automatic (1) */
  boardZoom: number | null;
  /** the resting tilt in degrees from straight down (20 to 60); null: automatic (32 on every TV measured) */
  boardTilt: number | null;
  /** "Fly over Mars": the 3D board's camera can be flown (F, the options, a gamepad or a phone) */
  fly: boolean;
  /** banking gently into turns while flying */
  flyBank: boolean;
};

export const DEFAULT_SETTINGS: TvSettings = {master: 1, hum: true, humVolume: 1, effects: 1, voice: 1, textSize: 'large', weather: true, board3d: true, trTrack: true, cameraMoves: true, tileStyle: null, boardLife: true, terraformers: true, radio: false, radioVolume: 0.5,
  boardView: false, boardZoom: null, boardTilt: null, fly: false, flyBank: true};
export const SETTINGS_KEY = 'mars-ledger-tv-settings';

const unit = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : d);

/** Read stored settings; anything missing, malformed or out of range falls back to its default. */
export function parseSettings(raw: string | null): TvSettings {
  let o: Record<string, unknown> = {};
  try { o = raw ? JSON.parse(raw) : {}; } catch { o = {}; }
  if (!o || typeof o !== 'object') o = {};
  const d = DEFAULT_SETTINGS;
  return {
    master: unit(o.master, d.master),
    hum: typeof o.hum === 'boolean' ? o.hum : d.hum,
    humVolume: unit(o.humVolume, d.humVolume),
    effects: unit(o.effects, d.effects),
    voice: unit(o.voice, d.voice),
    textSize: TEXT_SIZES.includes(o.textSize as TextSize) ? o.textSize as TextSize : d.textSize,
    weather: typeof o.weather === 'boolean' ? o.weather : d.weather,
    board3d: typeof o.board3d === 'boolean' ? o.board3d : d.board3d,
    trTrack: typeof o.trTrack === 'boolean' ? o.trTrack : d.trTrack,
    cameraMoves: typeof o.cameraMoves === 'boolean' ? o.cameraMoves : d.cameraMoves,
    tileStyle: TILE_STYLES.includes(o.tileStyle as TileStyle) ? o.tileStyle as TileStyle : d.tileStyle,
    boardLife: typeof o.boardLife === 'boolean' ? o.boardLife : d.boardLife,
    terraformers: typeof o.terraformers === 'boolean' ? o.terraformers : d.terraformers,
    radio: typeof o.radio === 'boolean' ? o.radio : d.radio,
    radioVolume: unit(o.radioVolume, d.radioVolume),
    boardView: typeof o.boardView === 'boolean' ? o.boardView : d.boardView,
    boardZoom: o.boardZoom === null || o.boardZoom === undefined ? null : typeof o.boardZoom === 'number' && Number.isFinite(o.boardZoom) ? clampZoom(o.boardZoom) : d.boardZoom,
    boardTilt: clampTilt(o.boardTilt),
    fly: typeof o.fly === 'boolean' ? o.fly : d.fly,
    flyBank: typeof o.flyBank === 'boolean' ? o.flyBank : d.flyBank,
  };
}

type Store = Pick<Storage, 'getItem' | 'setItem'>;
function storage(): Store | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

export function loadSettings(s: Store | null = storage()): TvSettings {
  try { return parseSettings(s?.getItem(SETTINGS_KEY) ?? null); } catch { return {...DEFAULT_SETTINGS}; }
}

export function saveSettings(v: TvSettings, s: Store | null = storage()) {
  try { s?.setItem(SETTINGS_KEY, JSON.stringify(v)); } catch { /* private mode or blocked storage: keep it for this session */ }
}

// ---- live store --------------------------------------------------------------------------------
let current: TvSettings = loadSettings();
const listeners = new Set<() => void>();

export function getSettings(): TvSettings { return current; }

export function setSettings(patch: Partial<TvSettings>) {
  current = parseSettings(JSON.stringify({...current, ...patch}));
  saveSettings(current);
  applyTextScale(current);
  for (const l of listeners) l();
}

export function subscribeSettings(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }

export function useTvSettings(): TvSettings {
  return useSyncExternalStore(subscribeSettings, getSettings);
}

/** Publish the text factor as --tvt on the document, so every TV layer (including portals) can use it. */
export function applyTextScale(v: TvSettings = current) {
  if (typeof document === 'undefined') return;
  document.documentElement.style.setProperty('--tvt', String(TEXT_SCALE[v.textSize]));
}

/**
 * A secondary TV text size: the base in vw (never below 0.9vw, which is 1.6% of a 16:9 screen's height)
 * times the chosen text size.
 */
export function tvt(vw: number): string {
  return `calc(${Math.max(0.9, vw)}vw * var(--tvt, 1))`;
}
