// The end-of-game poster desk: renders in the background when a game ends (never on anyone's path),
// caches the PNGs per game and variant under DATA_DIR/posters/<gameId>/, and reports its status so
// phones can offer "Save the poster" and the TV can reveal it after the hall of fame.
import * as fs from 'node:fs';
import * as path from 'node:path';
import {hashOf, matchPainting, uniquePrompt} from '../../shared/poster';
import type {PosterFacts, PosterOrientation, PosterStatus, PosterVariant} from '../../shared/poster';
import {posterSvg} from './compose';
import type {PosterArt} from './compose';
import {ForgeClient} from './forge';
import {PosterAssets, findAssetsDir, initRenderer, rasterize} from './render';

export const THUMB_WIDTH = 480;
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

type Job = {facts: PosterFacts; unique: boolean; skipLibrary?: boolean};

export class PosterDesk {
  private statuses = new Map<string, PosterStatus>();
  private queue: Promise<void> = Promise.resolve();
  private pending = new Map<string, Job>();
  private warned = new Set<string>();
  readonly root: string;
  readonly assets: PosterAssets | null;

  constructor(private opts: {dataDir: string; forge: ForgeClient | null; onStatus: (s: PosterStatus) => void; assetsDir?: string | null; log?: (m: string) => void}) {
    this.root = path.join(opts.dataDir, 'posters');
    fs.mkdirSync(this.root, {recursive: true});
    const dir = opts.assetsDir === undefined ? findAssetsDir() : opts.assetsDir;
    let assets: PosterAssets | null = null;
    try { assets = dir ? new PosterAssets(dir) : null; } catch (e) { this.warn('assets', `poster assets unreadable: ${(e as Error).message}`); }
    this.assets = assets;
    if (!assets) this.warn('assets', 'poster assets not found; posters will use the styled fallback card');
    initRenderer(dir).catch((e) => this.warn('wasm', `poster renderer unavailable: ${(e as Error).message}`));
  }

  get uniqueAvailable(): boolean { return !!this.opts.forge; }

  private warn(key: string, message: string) {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    (this.opts.log ?? console.warn)(`poster: ${message}`);
  }

  private dir(gameId: string) { return path.join(this.root, gameId); }

  /** Status for a game, from memory or (after a restart) from disk. */
  status(gameId: string): PosterStatus | null {
    if (!SAFE_ID.test(gameId)) return null;
    const cached = this.statuses.get(gameId);
    if (cached) return cached;
    try {
      const s = JSON.parse(fs.readFileSync(path.join(this.dir(gameId), 'status.json'), 'utf8')) as PosterStatus;
      // A render interrupted by a restart is not coming back on its own.
      if (s.library === 'pending') s.library = 'failed';
      if (s.unique === 'pending') s.unique = 'skipped';
      this.statuses.set(gameId, s);
      return s;
    } catch {
      return null;
    }
  }

  private setStatus(s: PosterStatus) {
    this.statuses.set(s.gameId, s);
    try {
      fs.mkdirSync(this.dir(s.gameId), {recursive: true});
      writeAtomic(path.join(this.dir(s.gameId), 'status.json'), JSON.stringify(s));
    } catch (e) { this.warn('write', `could not save poster status: ${(e as Error).message}`); }
    this.opts.onStatus(s);
  }

  /** The PNG for a variant, or null when it does not exist (yet). */
  file(gameId: string, variant: PosterVariant, orientation: PosterOrientation, thumb = false): string | null {
    if (!SAFE_ID.test(gameId)) return null;
    const f = path.join(this.dir(gameId), `${variant}-${thumb ? 'thumb' : orientation}.png`);
    return fs.existsSync(f) ? f : null;
  }

  /**
   * A game has ended (or its final scores changed). Renders in the background; calling again for
   * the same game with new facts re-renders; identical facts are left alone.
   */
  submit(facts: PosterFacts, unique: boolean) {
    if (!SAFE_ID.test(facts.gameId)) return;
    const prev = this.status(facts.gameId);
    const saved = readJson<PosterFacts>(path.join(this.dir(facts.gameId), 'facts.json'));
    const sameFacts = !!saved && JSON.stringify(saved) === JSON.stringify(facts);
    const libraryDone = sameFacts && prev?.library === 'ready';
    // The illustration is painted once; a busy or unreachable Forge earlier is tried again.
    const uniqueWanted = unique && !!this.opts.forge && prev?.unique !== 'ready' && prev?.unique !== 'pending';
    const recomposeUnique = !sameFacts && prev?.unique === 'ready';
    if (libraryDone && !uniqueWanted) return;
    this.setStatus({
      gameId: facts.gameId,
      library: libraryDone ? 'ready' : 'pending',
      unique: uniqueWanted ? 'pending' : prev?.unique ?? 'off',
      version: prev?.version ?? 0,
      painting: prev?.painting ?? null,
    });
    this.enqueue(facts.gameId, {facts, unique: uniqueWanted || recomposeUnique, skipLibrary: libraryDone});
  }

  /** The table turned the one-off illustration on (or off) after the game ended. */
  setUnique(gameId: string, on: boolean) {
    const s = this.status(gameId);
    if (!s || !on || !this.opts.forge || s.unique === 'ready' || s.unique === 'pending') return;
    const facts = readJson<PosterFacts>(path.join(this.dir(gameId), 'facts.json'));
    if (!facts) return;
    this.setStatus({...s, unique: 'pending'});
    this.enqueue(gameId, {facts, unique: true, skipLibrary: s.library === 'ready'});
  }

  private enqueue(gameId: string, job: Job) {
    const already = this.pending.has(gameId);
    this.pending.set(gameId, job);
    if (already) return; // the queued run picks up the newest facts
    this.queue = this.queue.then(() => this.run(gameId)).catch((e) => this.warn('run', `poster run failed: ${(e as Error).message}`));
  }

  /** Wait until everything queued so far has finished (tests, shutdown). */
  idle(): Promise<void> { return this.queue; }

  private async run(gameId: string) {
    const job = this.pending.get(gameId);
    this.pending.delete(gameId);
    if (!job) return;
    const {facts} = job;
    const dir = this.dir(gameId);
    fs.mkdirSync(dir, {recursive: true});
    writeAtomic(path.join(dir, 'facts.json'), JSON.stringify(facts));

    // 1. The library poster (skipped when only the illustration is new).
    const painting = this.assets ? matchPainting(facts, this.assets.library) : null;
    const art: PosterArt = {painting: painting && this.assets ? this.assets.painting(painting.file) : null, portraits: this.portraits(facts)};
    if (!job.skipLibrary) {
      let library: PosterStatus['library'] = 'ready';
      try {
        await this.compose(dir, 'library', facts, art);
      } catch (e) {
        this.warn(`compose-${gameId}`, `library poster for ${gameId} failed: ${(e as Error).message}`);
        library = 'failed';
      }
      const cur = this.status(gameId)!;
      // Newer facts may already be queued; they re-render and report again.
      this.setStatus({...cur, library: this.pending.has(gameId) ? 'pending' : library, painting: painting?.file ?? null, version: cur.version + (library === 'ready' ? 1 : 0)});
    }

    // 2. The one-off illustration: painted once per game, recomposed when the scores change.
    const artFile = path.join(dir, 'unique-art.png');
    const wantUnique = job.unique && !!this.opts.forge;
    if (!wantUnique && !fs.existsSync(artFile)) return;
    if (!fs.existsSync(artFile) && this.opts.forge) {
      const r = await this.opts.forge.paint(uniquePrompt(facts), hashOf(gameId) % 2147483647);
      if (!r.ok) {
        this.warn(`forge-${r.reason}`, `one-off illustration skipped (${r.reason}${r.detail ? `: ${r.detail}` : ''})`);
        const s = this.status(gameId)!;
        this.setStatus({...s, unique: 'skipped'});
        return;
      }
      writeAtomic(artFile, r.png);
    }
    try {
      const uniqueArt: PosterArt = {painting: `data:image/png;base64,${fs.readFileSync(artFile).toString('base64')}`, portraits: art.portraits};
      await this.compose(dir, 'unique', facts, uniqueArt);
      const s = this.status(gameId)!;
      this.setStatus({...s, unique: 'ready', version: s.version + 1});
    } catch (e) {
      this.warn(`compose-unique-${gameId}`, `one-off poster for ${gameId} failed: ${(e as Error).message}`);
      const s = this.status(gameId)!;
      this.setStatus({...s, unique: 'skipped'});
    }
  }

  private portraits(facts: PosterFacts): Map<string, string> {
    const out = new Map<string, string>();
    for (const p of facts.players) {
      if (!p.portrait || !this.assets) continue;
      const uri = this.assets.portrait(p.portrait);
      if (uri) out.set(p.portrait, uri);
    }
    return out;
  }

  /** Landscape, portrait and a landscape thumbnail. A missing painting falls back to the styled background. */
  private async compose(dir: string, variant: PosterVariant, facts: PosterFacts, art: PosterArt) {
    if (!this.assets) throw new Error('no poster assets');
    await initRenderer(this.assets.dir);
    const render = async (a: PosterArt) => {
      const land = posterSvg(facts, a, 'landscape');
      const files: Array<[string, Buffer]> = [
        [`${variant}-landscape.png`, await rasterize(land, this.assets!.fonts)],
        [`${variant}-portrait.png`, await rasterize(posterSvg(facts, a, 'portrait'), this.assets!.fonts)],
        [`${variant}-thumb.png`, await rasterize(land, this.assets!.fonts, THUMB_WIDTH)],
      ];
      for (const [name, png] of files) writeAtomic(path.join(dir, name), png);
    };
    try {
      await render(art);
    } catch (e) {
      if (!art.painting) throw e;
      this.warn(`painting-${variant}`, `poster painting could not be drawn, using the plain background: ${(e as Error).message}`);
      await render({...art, painting: null});
    }
  }
}

function readJson<T>(file: string): T | null {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) as T; } catch { return null; }
}

function writeAtomic(file: string, data: string | Buffer) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}
