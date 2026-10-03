// Resource tokens for the production show, drawn on canvas. Same glyphs as ResIcon, rendered as
// chunky game pieces: a soft body shadow, the glyph, and a glossy top light.
import type {Resource} from '../../shared/types';

export type TokenKind = Resource | 'flame';

export const TOKEN_HEX: Record<TokenKind, string> = {
  megacredits: '#F2C230', steel: '#B07A45', titanium: '#9AA3B8', plants: '#5BBE6A', energy: '#A765DB', heat: '#F0643A', flame: '#FFB347',
};

const GLOSS = `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset=".45" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>`;

const SVG: Record<TokenKind, string> = {
  megacredits: `<rect x="2.5" y="2.5" width="19" height="19" rx="4" fill="#F2C230"/><rect x="2.5" y="2.5" width="19" height="19" rx="4" fill="url(#g)"/><rect x="2.5" y="2.5" width="19" height="19" rx="4" fill="none" stroke="#8A6208" stroke-width=".9"/><path d="M7 16.5V8l5 5 5-5v8.5" stroke="#3A2503" stroke-width="2.3" fill="none" stroke-linejoin="round" stroke-linecap="round"/>`,
  steel: `<path d="M4 8.5 12 4l8 4.5v7L12 20l-8-4.5z" fill="#B07A45"/><path d="M4 8.5 12 4l8 4.5L12 13z" fill="#D39A5F"/><path d="M12 13v7l-8-4.5v-7z" fill="#8C5C30"/><path d="M4 8.5 12 4l8 4.5v7L12 20l-8-4.5z" fill="url(#g)"/>`,
  titanium: `<path d="M4 8.5 12 4l8 4.5v7L12 20l-8-4.5z" fill="#2E313B" stroke="#9AA3B8" stroke-width="1.1"/><path d="m12 7.2 1.4 2.9 3.2.4-2.3 2.2.6 3.1L12 14.3l-2.9 1.5.6-3.1-2.3-2.2 3.2-.4z" fill="#F2C230"/><path d="M4 8.5 12 4l8 4.5v7L12 20l-8-4.5z" fill="url(#g)"/>`,
  plants: `<path d="M12 21c-5-3-7-7-6-13 5 0 9 3 9 8M12 21c4-2 6-6 6-11-3 0-6 2-6 5" fill="#5BBE6A"/><path d="M12 21c-5-3-7-7-6-13 5 0 9 3 9 8" fill="url(#g)"/><path d="M12 21V11" stroke="#173A1E" stroke-width="1.3"/>`,
  energy: `<circle cx="12" cy="12" r="9.5" fill="#A765DB"/><circle cx="12" cy="12" r="9.5" fill="url(#g)"/><path d="M13.2 4.8 8 13h3.6l-1.1 6.2L16 11h-3.7z" fill="#F3E6FF"/>`,
  heat: `<path d="M12 2.5c1 3.5 5.5 5.5 5.5 10.5a5.5 5.5 0 0 1-11 0c0-2.5 1.3-4 2.3-5 .2 1.8.9 2.8 2 3.3C10.4 8.5 11 5.5 12 2.5z" fill="#F0643A"/><path d="M12 12.5c.6 1.5 2.3 2.3 2.3 4a2.3 2.3 0 0 1-4.6 0c0-1.2.9-2 2.3-4z" fill="#FFD9A0"/>`,
  flame: `<path d="M12 1.5c1.2 3.8 6.2 6 6.2 11.5a6.2 6.2 0 0 1-12.4 0c0-2.8 1.5-4.4 2.6-5.5.2 2 1 3.1 2.2 3.6C10.2 8 11 4.8 12 1.5z" fill="#FF7A2E"/><path d="M12 10.5c.8 1.9 3 3 3 5.2a3 3 0 0 1-6 0c0-1.6 1.2-2.6 3-5.2z" fill="#FFE08A"/>`,
};

const cache = new Map<TokenKind, HTMLImageElement>();

/** One image per token kind, rasterised from SVG at a size that stays crisp when scaled up. */
export function tokenImage(kind: TokenKind): HTMLImageElement {
  let img = cache.get(kind);
  if (!img) {
    img = new Image();
    img.decoding = 'async';
    // bake the bitmap and the shadow as soon as the image is in, not on a show's first frame (~60 ms for all kinds)
    const k = kind, im = img;
    img.onload = () => { tokenBitmap(k, im); tokenShadow(k, im); };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 24 24">${GLOSS}${SVG[kind]}</svg>`);
    cache.set(kind, img);
  }
  return img;
}

/** Each token's drop shadow, blurred once into its own canvas. A canvas shadowBlur on every token draw re-blurs on
 *  every frame (hundreds of tokens, growing to several times their size as they fly out); that saturated the GPU
 *  process and held the TV's show at 30–50 ms frames. Same look: the shadow keeps the token's turn and falls straight
 *  down (an offset of 0.12 of its size, blur 0.25 of its size, 45 % black). */
const SHADOW_BASE = 128, SHADOW_PAD = 48;
/** Each token rasterised once to a bitmap: drawing the SVG image itself at a new size every frame re-rasterises it. */
const BITMAP = 384;
const bitmaps = new Map<TokenKind, HTMLCanvasElement>();
function tokenBitmap(kind: TokenKind, img: HTMLImageElement): CanvasImageSource {
  let c = bitmaps.get(kind);
  if (c) return c;
  if (typeof document === 'undefined') return img;
  c = document.createElement('canvas');
  c.width = c.height = BITMAP;
  const g = c.getContext('2d');
  if (!g) return img;
  g.drawImage(img, 0, 0, BITMAP, BITMAP);
  bitmaps.set(kind, c);
  return c;
}
const shadows = new Map<TokenKind, HTMLCanvasElement>();
function tokenShadow(kind: TokenKind, img: HTMLImageElement): HTMLCanvasElement | null {
  let c = shadows.get(kind);
  if (c) return c;
  if (typeof document === 'undefined') return null;
  c = document.createElement('canvas');
  c.width = c.height = SHADOW_BASE + 2 * SHADOW_PAD;
  const g = c.getContext('2d');
  if (!g) return null;
  // draw the token far off the canvas so only its shadow lands on it
  g.shadowColor = 'rgba(0,0,0,.45)';
  g.shadowBlur = SHADOW_BASE * 0.25;
  g.shadowOffsetX = 4096;
  g.drawImage(img, SHADOW_PAD - 4096, SHADOW_PAD, SHADOW_BASE, SHADOW_BASE);
  shadows.set(kind, c);
  return c;
}

export function preloadTokens() {
  (Object.keys(SVG) as TokenKind[]).forEach(tokenImage);
}

/** Draw a token centred at (x, y) with size s, rotation rot, alpha a; blur draws velocity ghosts (`trails` false
 *  leaves them out, for a screen that cannot keep up). */
export function drawToken(ctx: CanvasRenderingContext2D, kind: TokenKind, x: number, y: number, s: number, rot: number, a: number, vx = 0, vy = 0, trails = true) {
  const img = tokenImage(kind);
  if (!img.complete || a <= 0.01) return;
  const bmp = tokenBitmap(kind, img);
  const speed = Math.hypot(vx, vy);
  const ghosts = !trails ? 0 : speed > 900 ? 3 : speed > 450 ? 2 : 0;
  for (let g = ghosts; g >= 0; g--) {
    const k = g / (ghosts + 1);
    const gx = x - vx * 0.018 * g;
    const gy = y - vy * 0.018 * g;
    ctx.globalAlpha = a * (g === 0 ? 1 : 0.28 * (1 - k));
    if (g === 0) {
      const sh = tokenShadow(kind, img);
      if (sh) {
        const m = s * SHADOW_PAD / SHADOW_BASE;
        ctx.save();
        ctx.translate(gx, gy + s * 0.12);
        ctx.rotate(rot);
        ctx.drawImage(sh, -s / 2 - m, -s / 2 - m, s + 2 * m, s + 2 * m);
        ctx.restore();
      }
    }
    ctx.save();
    ctx.translate(gx, gy);
    ctx.rotate(rot);
    ctx.drawImage(bmp, -s / 2, -s / 2, s, s);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

/** A spark: a short glowing streak along its velocity. */
export function drawSpark(ctx: CanvasRenderingContext2D, x: number, y: number, vx: number, vy: number, size: number, color: string, a: number) {
  if (a <= 0.01) return;
  ctx.globalAlpha = a;
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineWidth = size;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x - vx * 0.03, y - vy * 0.03);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

export const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
export const easeInCubic = (t: number) => t * t * t;
export const easeOutBack = (t: number) => { const c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
export const clamp01 = (t: number) => Math.max(0, Math.min(1, t));

/** Deterministic pseudo-random numbers so a show looks the same on a replayed frame. */
export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; };
}

export function hashString(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** A canvas that fills its parent at device pixel ratio, with a stable 2D context. */
export function fitCanvas(c: HTMLCanvasElement): {ctx: CanvasRenderingContext2D; w: number; h: number} {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = c.clientWidth;
  const h = c.clientHeight;
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
  }
  const ctx = c.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return {ctx, w, h};
}

export const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
