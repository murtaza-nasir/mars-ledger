// Full-mode smoke test against a real engine.
//   engine: (cd vendor/tm && mkdir -p db/files && PORT=8795 LOCAL_FS_DB=1 node build/src/server/server.js)
//   run:    ENGINE_URL=http://localhost:8795 npx tsx tests/full/smoke.ts
// Starts our server on a spare port with a throwaway DATA_DIR, plays lobby -> full start -> corporations
// -> an Aquifer (ocean space input), and checks both phones and the TV saw the ocean tile.
import {spawn} from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import WebSocket from 'ws';
import type {FullView, InputResponse, PlayerInputModel} from '../../src/shared/full';
import {payment, TILE} from '../../src/shared/full';
import type {GameState} from '../../src/shared/game';
import type {ServerMsg} from '../../src/shared/protocol';

const PORT = Number(process.env.SMOKE_PORT ?? 8796);
const ENGINE_URL = process.env.ENGINE_URL ?? 'http://localhost:8795';
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-smoke-'));

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error('ASSERT: ' + msg);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class Client {
  ws: WebSocket;
  state: GameState | null = null;
  view: FullView | null = null;
  views = 0;
  private pending = new Map<string, {ok: () => void; fail: (e: Error) => void}>();
  private n = 0;
  constructor(public name: string, public role: 'phone' | 'tv', public playerId: string | null) {
    this.ws = new WebSocket(`ws://localhost:${PORT}/ws`);
    this.ws.on('message', (raw) => {
      const m = JSON.parse(String(raw)) as ServerMsg;
      if (m.type === 'state' || m.type === 'tick' || m.type === 'undone') this.state = m.state;
      if (m.type === 'full') { this.view = m.view; this.views++; }
      if (m.type === 'ack') { this.pending.get(m.id)?.ok(); this.pending.delete(m.id); }
      if (m.type === 'nack') { this.pending.get(m.id)?.fail(new Error(m.error)); this.pending.delete(m.id); }
    });
  }
  async open() {
    await new Promise<void>((r, j) => { this.ws.once('open', () => r()); this.ws.once('error', j); });
    this.ws.send(JSON.stringify({type: 'hello', role: this.role, playerId: this.playerId}));
  }
  rpc(msg: Record<string, unknown>): Promise<void> {
    const id = `${this.name}-${++this.n}`;
    return new Promise((ok, fail) => {
      this.pending.set(id, {ok, fail});
      this.ws.send(JSON.stringify({...msg, id}));
      setTimeout(() => { if (this.pending.delete(id)) fail(new Error(`${this.name}: timeout`)); }, 20000);
    });
  }
  cmd(command: Record<string, unknown>) { return this.rpc({type: 'cmd', command}); }
  input(response: InputResponse) { return this.rpc({type: 'input', playerId: this.playerId, response}); }
  waitingFor(): PlayerInputModel | undefined { return this.view?.role === 'player' ? this.view.model.waitingFor : undefined; }
}

async function until(what: string, f: () => boolean, ms = 15000) {
  const t0 = Date.now();
  while (!f()) { if (Date.now() - t0 > ms) throw new Error('timeout waiting for ' + what); await sleep(100); }
}

const server = spawn(process.execPath, ['--import', 'tsx', 'src/server/index.ts'], {
  env: {...process.env, PORT: String(PORT), DATA_DIR: dataDir, ENGINE_URL, ENGINE_POLL_MS: '500', VISION_ENABLED: 'false'},
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stderr.on('data', (d) => process.stderr.write('[server] ' + d));

try {
  for (let i = 0; ; i++) {
    try { const r = await fetch(`http://localhost:${PORT}/api/config`); if (r.ok) break; } catch { /* starting */ }
    if (i > 100) throw new Error('server did not start');
    await sleep(100);
  }
  const a = new Client('a', 'phone', 'pa');
  const b = new Client('b', 'phone', 'pb');
  const tv = new Client('tv', 'tv', null);
  await Promise.all([a.open(), b.open(), tv.open()]);

  await a.cmd({t: 'join', playerId: 'pa', name: 'Alice', color: 'red'});
  await b.cmd({t: 'join', playerId: 'pb', name: 'Bob', color: 'blue'});
  await a.cmd({t: 'start', playerId: 'pa', modules: ['base', 'corpera'], order: ['pa', 'pb'], mode: 'full', draft: false});
  await until('full state', () => a.state?.phase === 'full' && !!a.state.full);
  await until('views', () => a.view?.role === 'player' && b.view?.role === 'player' && tv.view?.role === 'spectator');
  console.log('started', a.state!.full!.gameId, 'views ok');

  // Corporation + initial buy: first corp, keep no cards (money for the Aquifer).
  for (const c of [a, b]) {
    const w = c.waitingFor();
    assert(w?.type === 'initialCards', `${c.name} should be choosing initial cards, got ${w?.type}`);
    const corpInput = (w as Extract<PlayerInputModel, {type: 'initialCards'}>).options[0] as Extract<PlayerInputModel, {type: 'card'}>;
    const corp = corpInput.cards.find((x) => x.name !== 'Beginner Corporation')!.name;
    await c.input({type: 'initialCards', responses: [{type: 'card', cards: [corp]}, {type: 'card', cards: []}]});
    console.log(c.name, 'chose', corp);
  }

  // First player takes Aquifer from the standard projects, then answers the space input.
  await until('action menu', () => a.waitingFor()?.type === 'or');
  const menu = a.waitingFor() as Extract<PlayerInputModel, {type: 'or'}>;
  const spIdx = menu.options.findIndex((o) => o.type === 'projectCard' && JSON.stringify(o.title).includes('Standard projects'));
  assert(spIdx >= 0, 'standard projects option present');
  const mc = a.view!.role === 'player' ? a.view!.model.thisPlayer.megacredits : 0;
  assert(mc >= 18, `needs 18 M€ for Aquifer, has ${mc}`);
  await a.input({type: 'or', index: spIdx, response: {type: 'projectCard', card: 'Aquifer', payment: payment({megacredits: 18})}});
  await until('space input', () => a.waitingFor()?.type === 'space');
  const spaces = (a.waitingFor() as Extract<PlayerInputModel, {type: 'space'}>).spaces;
  const spaceId = spaces[0];

  // Hover relay: the TV sees Alice's finger over the space before she confirms.
  let hovered = false;
  tv.ws.on('message', (raw) => { const m = JSON.parse(String(raw)); if (m.type === 'hover' && m.hover.spaceId === spaceId) hovered = true; });
  a.ws.send(JSON.stringify({type: 'hover', hover: {playerId: 'pa', color: 'red', spaceId, tile: 'ocean'}}));
  await until('hover relay', () => hovered, 3000);

  const before = {a: a.views, b: b.views, tv: tv.views};
  await a.input({type: 'space', spaceId});
  const hasOcean = (v: FullView | null) => !!v && v.model.game.spaces.some((s) => s.id === spaceId && s.tileType === TILE.OCEAN);
  await until('ocean on every device', () => hasOcean(a.view) && hasOcean(b.view) && hasOcean(tv.view));
  assert(a.views > before.a && b.views > before.b && tv.views > before.tv, 'every device got a fresh view');
  assert(tv.view!.model.game.oceans === 1, 'one ocean on the board');
  assert((tv.view!.logs ?? []).length > 0, 'spectator view carries log lines');

  // An engine rule error comes back as a nack with the engine's message.
  const err = await b.input({type: 'space', spaceId: '99'}).then(() => null, (e: Error) => e.message);
  assert(err, 'invalid input is rejected');
  console.log('engine error relayed:', err);

  console.log(`SMOKE OK: ocean at ${spaceId}; views a=${a.views} b=${b.views} tv=${tv.views}; logs=${tv.view!.logs!.length}`);
  for (const c of [a, b, tv]) c.ws.close();
} catch (e) {
  console.error('SMOKE FAILED:', (e as Error).message);
  process.exitCode = 1;
} finally {
  server.kill();
  fs.rmSync(dataDir, {recursive: true, force: true});
}
