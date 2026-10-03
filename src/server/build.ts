// The build this server serves: the id in CLIENT_DIST/build.txt (written by deploy/Dockerfile from the bundle, the same
// string the client carries as __BUILD_ID__). Sent with hello and every heartbeat, so a screen left open across a deploy
// sees that a newer bundle is being served and reloads at a quiet moment (src/client/update.ts). Null when the file is
// absent (local runs without it): clients then never reload.
import * as fs from 'node:fs';
import * as path from 'node:path';

const file = path.join(path.resolve(process.env.CLIENT_DIST ?? 'dist'), 'build.txt');
let cached: {id: string | null; at: number} = {id: null, at: 0};

export function serverBuild(now = Date.now()): string | null {
  // re-read now and then: a dist replaced under a running server is a new build too
  if (now - cached.at < 10_000) return cached.id;
  let id: string | null = null;
  try { id = fs.readFileSync(file, 'utf8').trim() || null; } catch { /* no build.txt */ }
  cached = {id, at: now};
  return id;
}
