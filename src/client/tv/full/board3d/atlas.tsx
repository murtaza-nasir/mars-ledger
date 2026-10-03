// The tops of the 3D hexes are the flat board's own drawings: each space's SVG (its ground, bonus glyphs, any
// tile's ground and a special's name; the tile itself and its owner are 3D models, tiles3d.tsx) is rendered to markup, rasterised to a canvas at the screen's resolution and used as
// that hex's texture. The board's font is embedded, so labels keep Saira inside the image.
import {renderToStaticMarkup} from 'react-dom/server';
import * as THREE from 'three';
import sairaLatin from '@fontsource-variable/saira/files/saira-latin-wdth-normal.woff2?url';
import {BoardTypeContext} from '../boardType';
import type {BoardType} from '../boardType';
import {SpaceBase} from '../Board';
import {Claim, Defs, GroundTop3D} from '../Tiles';
import {HEX_R, HEX_W} from '../geometry';
import type {SpaceModel} from '../../../../shared/full';

let fontCss: Promise<string> | null = null;
async function b64(url: string): Promise<string> {
  const buf = new Uint8Array(await (await fetch(url)).arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}
// Only the Latin face: every label on a space (tile names, the Hellas pole's "6 M€") is in it, and a second face
// split by unicode-range would load too late inside an SVG image and drop the whole line (seen with "€").
function fonts(): Promise<string> {
  fontCss ??= b64(sairaLatin).then((a) =>
    `@font-face{font-family:'Saira Variable';font-weight:100 900;font-stretch:50% 125%;src:url(data:font/woff2;base64,${a}) format('woff2');}`,
  ).catch(() => '');
  return fontCss;
}

let defs: string | null = null;
function defsMarkup(): string {
  defs ??= renderToStaticMarkup(<svg><Defs /></svg>).replace(/^<svg>|<\/svg>$/g, '');
  return defs;
}

/** The SVG for one space's top, in board units centred on the hex. */
export function cellMarkup(s: SpaceModel, t: BoardType): string {
  return renderToStaticMarkup(
    <BoardTypeContext.Provider value={t}>
      <g>
        <SpaceBase s={s} t={t} />
        {/* a placed tile's look comes from its 3D model; the top keeps its ground and a special's name */}
        {s.tileType !== undefined && <GroundTop3D tileType={s.tileType} />}
        {/* a Land Claim: the tinted dashed rim and 'Claimed' (its flag is 3D) */}
        {s.tileType === undefined && s.color && s.color !== 'neutral' && <Claim color={s.color} flag={false} />}
      </g>
    </BoardTypeContext.Provider>,
  );
}

/** Texture size for a hex top: about two texels per screen pixel at the closest camera, a power of two. */
export function texelsFor(hexScreenPx: number): number {
  const want = Math.max(128, Math.min(1024, hexScreenPx * 2));
  return 2 ** Math.round(Math.log2(want));
}

/** Draw a space's top into a canvas texture (created on first use, redrawn in place afterwards). */
export async function paintCell(s: SpaceModel, t: BoardType, size: number, into?: THREE.CanvasTexture): Promise<THREE.CanvasTexture> {
  const w = Math.round(size * (HEX_W / (2 * HEX_R)));
  const h = size;
  const css = await fonts();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${-HEX_W / 2} ${-HEX_R} ${HEX_W} ${2 * HEX_R}">` +
    `<style>${css}</style>${defsMarkup()}${cellMarkup(s, t)}</svg>`;
  const img = new Image();
  img.decoding = 'async';
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  await img.decode();
  const canvas = (into?.image as HTMLCanvasElement | undefined) ?? document.createElement('canvas');
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  const tex = into ?? new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

/** A key that changes whenever the drawing of a space's top would. */
export function cellKey(s: SpaceModel, t: BoardType, size: number): string {
  return `${s.id}|${s.spaceType}|${s.tileType ?? '-'}|${s.color ?? '-'}|${s.bonus.join(',')}|${s.highlight ?? '-'}|${t.text.toFixed(2)}|${t.min.toFixed(2)}|${t.icon.toFixed(3)}|${size}`;
}
