// Rasterizing the poster SVG to PNG with resvg (WebAssembly: no native build step), using the static
// Saira instances and JPEG copies of the paintings and portraits in server-assets/poster.
import * as fs from 'node:fs';
import * as path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {initWasm, Resvg} from '@resvg/resvg-wasm';
import type {Painting} from '../../shared/poster';

const here = path.dirname(fileURLToPath(import.meta.url));

/** server-assets/poster: next to the bundle in Docker (/app), or at the repo root in development. */
export function findAssetsDir(): string | null {
  // An explicit POSTER_ASSETS is the only place looked at (a wrong path shows the fallback card).
  if (process.env.POSTER_ASSETS) return fs.existsSync(path.join(process.env.POSTER_ASSETS, 'fonts')) ? process.env.POSTER_ASSETS : null;
  const candidates = [
    path.resolve('server-assets/poster'),
    path.resolve(here, 'server-assets/poster'),
    path.resolve(here, '../../../server-assets/poster'),
  ].filter((x): x is string => !!x);
  return candidates.find((d) => fs.existsSync(path.join(d, 'fonts'))) ?? null;
}

function findWasm(assets: string | null): string | null {
  const req = createRequire(import.meta.url);
  const candidates: string[] = [];
  if (process.env.RESVG_WASM) candidates.push(process.env.RESVG_WASM);
  if (assets) candidates.push(path.join(assets, '..', 'resvg.wasm'));
  try { candidates.push(req.resolve('@resvg/resvg-wasm/index_bg.wasm')); } catch { /* not installed next to the bundle */ }
  return candidates.find((f) => fs.existsSync(f)) ?? null;
}

export class PosterAssets {
  readonly fonts: Uint8Array[];
  readonly library: Painting[];
  private paintingCache = new Map<string, string | null>();
  private portraitCache = new Map<string, string | null>();

  constructor(readonly dir: string) {
    const fontDir = path.join(dir, 'fonts');
    this.fonts = fs.readdirSync(fontDir).filter((f) => f.endsWith('.ttf')).sort().map((f) => new Uint8Array(fs.readFileSync(path.join(fontDir, f))));
    const lib = path.join(dir, 'paintings', 'library.json');
    this.library = fs.existsSync(lib) ? JSON.parse(fs.readFileSync(lib, 'utf8')) as Painting[] : [];
  }

  private dataUri(file: string, cache: Map<string, string | null>): string | null {
    if (!cache.has(file)) {
      const f = path.join(this.dir, file);
      cache.set(file, fs.existsSync(f) ? `data:image/jpeg;base64,${fs.readFileSync(f).toString('base64')}` : null);
    }
    return cache.get(file)!;
  }

  painting(name: string): string | null { return /^[a-z0-9-]+$/.test(name) ? this.dataUri(path.join('paintings', `${name}.jpg`), this.paintingCache) : null; }
  portrait(number: string): string | null { return /^[A-Za-z0-9]+$/.test(number) ? this.dataUri(path.join('portraits', `${number}.jpg`), this.portraitCache) : null; }
}

let ready: Promise<void> | null = null;

/** Load the WebAssembly module once per process. */
export function initRenderer(assets: string | null): Promise<void> {
  if (!ready) {
    const wasm = findWasm(assets);
    ready = wasm ? initWasm(fs.readFileSync(wasm)) : Promise.reject(new Error('resvg.wasm not found'));
    ready.catch(() => { /* reported by the caller */ });
  }
  return ready;
}

/** SVG → PNG. `width` scales the output (thumbnails); the default is the SVG's own size. */
export async function rasterize(svg: string, fonts: Uint8Array[], width?: number): Promise<Buffer> {
  const r = new Resvg(svg, {
    font: {fontBuffers: fonts, loadSystemFonts: false, defaultFontFamily: 'Poster Saira'},
    fitTo: width ? {mode: 'width', value: width} : {mode: 'original'},
    imageRendering: 0,
    shapeRendering: 2,
    textRendering: 1,
  });
  const out = r.render();
  const png = out.asPng();
  out.free?.();
  r.free?.();
  return Buffer.from(png);
}
