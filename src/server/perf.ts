// Performance recordings and screen recordings from phones, for the /perf diagnostics pages.
//   POST /api/perf            a phone's session (JSON); the same session id replaces the earlier upload
//   GET  /api/perf            sessions, newest first, with headline numbers per interaction type
//   GET  /api/perf/:id        one session in full
//   POST /api/perf/video      an iPhone screen recording (multipart, streamed to disk)
//   GET  /api/perf/videos     the uploads, newest first
//   GET  /api/perf/video/:id  one upload's file
// Sessions live in their own table in the server's database (last 200 kept); videos in DATA_DIR/perf-video
// (newest few kept, under a total size cap).
import type {FastifyInstance} from 'fastify';
import multipart from '@fastify/multipart';
import type {DatabaseSync} from 'node:sqlite';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {pipeline} from 'node:stream/promises';
import {nanoid} from 'nanoid';
import {cleanSession, headlines, type PerfListItem, type PerfSession} from '../shared/perf';

export type PerfOptions = {
  db: DatabaseSync;
  dataDir: string;
  maxSessions?: number;
  /** One upload's size cap, bytes. */
  maxVideoBytes?: number;
  /** Uploads kept (newest first). */
  maxVideos?: number;
  /** All uploads together, bytes. */
  maxVideoTotal?: number;
};

export type PerfVideo = {id: string; created: number; name: string; size: number; mime: string; label: string};

const VIDEO_TYPES: Record<string, string> = {'.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm'};

export class PerfDesk {
  readonly maxSessions: number;
  readonly maxVideoBytes: number;
  readonly maxVideos: number;
  readonly maxVideoTotal: number;
  readonly videoDir: string;
  constructor(readonly db: DatabaseSync, dataDir: string, o: Omit<PerfOptions, 'db' | 'dataDir'> = {}) {
    this.maxSessions = o.maxSessions ?? 200;
    this.maxVideoBytes = o.maxVideoBytes ?? 250 * 1024 * 1024;
    this.maxVideos = o.maxVideos ?? 12;
    this.maxVideoTotal = o.maxVideoTotal ?? 1536 * 1024 * 1024;
    this.videoDir = path.join(dataDir, 'perf-video');
    fs.mkdirSync(this.videoDir, {recursive: true});
    db.exec(`
      CREATE TABLE IF NOT EXISTS perf_sessions (id TEXT PRIMARY KEY, started INTEGER NOT NULL, sent INTEGER NOT NULL,
        received INTEGER NOT NULL, json TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS perf_sessions_received ON perf_sessions (received);
      CREATE TABLE IF NOT EXISTS perf_videos (id TEXT PRIMARY KEY, created INTEGER NOT NULL, name TEXT NOT NULL, size INTEGER NOT NULL,
        mime TEXT NOT NULL, file TEXT NOT NULL, label TEXT NOT NULL DEFAULT '');
    `);
  }

  save(s: PerfSession, now = Date.now()) {
    this.db.prepare(`INSERT INTO perf_sessions (id, started, sent, received, json) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET sent = excluded.sent, received = excluded.received, json = excluded.json`)
      .run(s.id, s.startedAt, s.sentAt, now, JSON.stringify(s));
    // keep the most recently received sessions
    this.db.prepare(`DELETE FROM perf_sessions WHERE id NOT IN (SELECT id FROM perf_sessions ORDER BY received DESC, id LIMIT ?)`).run(this.maxSessions);
  }

  get(id: string): PerfSession | null {
    const row = this.db.prepare('SELECT json FROM perf_sessions WHERE id = ?').get(id) as {json: string} | undefined;
    return row ? JSON.parse(row.json) as PerfSession : null;
  }

  list(): PerfListItem[] {
    const rows = this.db.prepare('SELECT json FROM perf_sessions ORDER BY started DESC').all() as Array<{json: string}>;
    return rows.map((r) => {
      const s = JSON.parse(r.json) as PerfSession;
      return {id: s.id, startedAt: s.startedAt, sentAt: s.sentAt, duration: s.duration, label: s.label, build: s.device.build, ua: s.device.ua,
        refreshHz: s.device.refreshHz, overall: s.overall, headlines: headlines(s.interactions)};
    });
  }

  count(): number { return (this.db.prepare('SELECT COUNT(*) AS n FROM perf_sessions').get() as {n: number}).n; }

  videos(): PerfVideo[] {
    return this.db.prepare('SELECT id, created, name, size, mime, label FROM perf_videos ORDER BY created DESC').all() as PerfVideo[];
  }

  videoFile(id: string): {file: string; mime: string; name: string; size: number} | null {
    if (!/^[A-Za-z0-9_-]{4,40}$/.test(id)) return null;
    const row = this.db.prepare('SELECT file, mime, name, size FROM perf_videos WHERE id = ?').get(id) as {file: string; mime: string; name: string; size: number} | undefined;
    if (!row) return null;
    const file = path.join(this.videoDir, path.basename(row.file));
    return fs.existsSync(file) ? {...row, file} : null;
  }

  addVideo(v: PerfVideo & {file: string}) {
    this.db.prepare('INSERT INTO perf_videos (id, created, name, size, mime, file, label) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(v.id, v.created, v.name, v.size, v.mime, v.file, v.label);
    this.pruneVideos();
  }

  /** Keeps the newest uploads within the count and total-size caps; removes stray files of failed uploads. */
  pruneVideos() {
    const rows = this.db.prepare('SELECT id, size, file FROM perf_videos ORDER BY created DESC, id').all() as Array<{id: string; size: number; file: string}>;
    let total = 0;
    const keep = new Set<string>();
    rows.forEach((r, i) => {
      total += r.size;
      if (i < this.maxVideos && (i === 0 || total <= this.maxVideoTotal)) { keep.add(r.file); return; }
      this.db.prepare('DELETE FROM perf_videos WHERE id = ?').run(r.id);
      fs.rmSync(path.join(this.videoDir, path.basename(r.file)), {force: true});
    });
    for (const f of fs.readdirSync(this.videoDir)) if (!keep.has(f) && !f.endsWith('.part')) fs.rmSync(path.join(this.videoDir, f), {force: true});
  }
}

export async function registerPerf(app: FastifyInstance, o: PerfOptions): Promise<PerfDesk> {
  const desk = new PerfDesk(o.db, o.dataDir, o);
  // leftovers of uploads cut off by a restart
  for (const f of fs.readdirSync(desk.videoDir)) if (f.endsWith('.part')) fs.rmSync(path.join(desk.videoDir, f), {force: true});

  app.post('/api/perf', {bodyLimit: 4 * 1024 * 1024}, async (req, reply) => {
    const s = cleanSession(req.body);
    if (!s) return reply.code(400).send({error: 'Not a performance session'});
    desk.save(s);
    return {ok: true, id: s.id, interactions: s.interactions.length};
  });

  app.get('/api/perf', async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    return {sessions: desk.list(), videos: desk.videos()};
  });

  app.get('/api/perf/videos', async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    return {videos: desk.videos()};
  });

  app.get('/api/perf/video/:id', async (req, reply) => {
    const v = desk.videoFile((req.params as {id: string}).id);
    if (!v) return reply.code(404).send({error: 'No such upload'});
    return reply.type(v.mime).header('Content-Length', v.size)
      .header('Content-Disposition', `attachment; filename="${v.name.replace(/[^A-Za-z0-9._-]/g, '_')}"`).send(fs.createReadStream(v.file));
  });

  app.get('/api/perf/:id', async (req, reply) => {
    const s = desk.get((req.params as {id: string}).id);
    if (!s) return reply.code(404).send({error: 'No such session'});
    reply.header('Cache-Control', 'no-store');
    return s;
  });

  // Uploads in their own scope, so multipart parsing applies to this route only.
  await app.register(async (scope) => {
    await scope.register(multipart, {limits: {fileSize: desk.maxVideoBytes, files: 1, fields: 4, fieldSize: 200}});
    scope.post('/api/perf/video', async (req, reply) => {
      if (!req.isMultipart()) return reply.code(415).send({error: 'Send the video as a form upload'});
      const part = await req.file();
      if (!part) return reply.code(400).send({error: 'No file in the upload'});
      const ext = path.extname(part.filename || '').toLowerCase();
      const mime = VIDEO_TYPES[ext] ?? (part.mimetype === 'video/quicktime' ? 'video/quicktime' : part.mimetype === 'video/mp4' ? 'video/mp4' : null);
      if (!mime) { part.file.resume(); return reply.code(415).send({error: 'Upload an .mp4 or .mov screen recording'}); }
      // letters and digits only: an id starting with '-' reads as an option on a command line
      const id = nanoid(10).replace(/[^A-Za-z0-9]/g, 'x');
      const fileExt = ext && VIDEO_TYPES[ext] ? ext : mime === 'video/quicktime' ? '.mov' : '.mp4';
      const file = `${id}${fileExt}`;
      const tmp = path.join(desk.videoDir, `${file}.part`);
      try {
        await pipeline(part.file, fs.createWriteStream(tmp));
      } catch (e) {
        fs.rmSync(tmp, {force: true});
        throw e;
      }
      if (part.file.truncated) {
        fs.rmSync(tmp, {force: true});
        return reply.code(413).send({error: `The video is over ${Math.round(desk.maxVideoBytes / 1048576)} MB`});
      }
      const size = fs.statSync(tmp).size;
      if (!size) { fs.rmSync(tmp, {force: true}); return reply.code(400).send({error: 'The file is empty'}); }
      fs.renameSync(tmp, path.join(desk.videoDir, file));
      const fields = part.fields as Record<string, {value?: unknown} | undefined>;
      const label = typeof fields.label?.value === 'string' ? fields.label.value.slice(0, 80) : '';
      const v = {id, created: Date.now(), name: (part.filename || file).slice(0, 120), size, mime, label, file};
      desk.addVideo(v);
      return {ok: true, id, size, name: v.name};
    });
  });
  return desk;
}
