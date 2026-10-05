// A character "skin": everything that makes one miniature look like itself, apart from how it moves. Two generic
// skins ship with the board.
export const HAIR_STYLES = ['none', 'short', 'bob', 'long', 'bun', 'curly', 'ponytail', 'spiky'] as const;
export const HELMET_STYLES = ['none', 'dome', 'round', 'crest'] as const;
export const GLASSES_STYLES = ['none', 'rect', 'round'] as const;
export const FACE_KEYS = ['neutral', 'happy', 'surprised', 'sleepy'] as const;
export const COLOR_KEYS = ['suit', 'trim', 'helmet', 'visor', 'skin', 'boots', 'pack', 'hair'] as const;

export type HairStyle = typeof HAIR_STYLES[number];
export type HelmetStyle = typeof HELMET_STYLES[number];
export type GlassesStyle = typeof GLASSES_STYLES[number];
export type FaceKey = typeof FACE_KEYS[number];
export type ColorKey = typeof COLOR_KEYS[number];

/** The face, drawn by the board (eyes, cheeks, mouth) for each expression. */
export type FaceDrawing = {kind: 'drawn'; eyes: string; cheek: string};

export type CharacterSkin = {
  id: string;
  label: string;
  colors: Record<ColorKey, string>;
  hair: HairStyle;
  helmet: HelmetStyle;
  glasses: GlassesStyle;
  /** body proportions as multipliers around the standard chibi build */
  build: {height: number; width: number; head: number};
  /** the face on the head's front */
  face: FaceDrawing;
};

export const DEFAULT_BUILD = {height: 1, width: 1, head: 1} as const;

/** The two generic characters. */
export const GENERIC_SKINS: CharacterSkin[] = [
  {
    id: 'generic-a', label: 'Engineer',
    colors: {suit: '#f1ece4', trim: '#f08a3c', helmet: '#f7f4ee', visor: '#2f7fc1', skin: '#d99a74', boots: '#6a554a', pack: '#8d99a3', hair: '#4a3022'},
    hair: 'short', helmet: 'dome', glasses: 'none', build: {height: 1, width: 1, head: 1.1}, face: {kind: 'drawn', eyes: '#2a1a14', cheek: '#e8745e'},
  },
  {
    id: 'generic-b', label: 'Botanist',
    colors: {suit: '#e6f1ee', trim: '#2bb39a', helmet: '#f0f6f3', visor: '#e8a43c', skin: '#b87e5a', boots: '#55706a', pack: '#a3b2ad', hair: '#1e1a28'},
    hair: 'bun', helmet: 'round', glasses: 'none', build: {height: 0.96, width: 0.95, head: 1.14}, face: {kind: 'drawn', eyes: '#1f1620', cheek: '#e0705f'},
  },
];
