// GET /api/health: the engine probe, its 10 s cache, companion-only setups, the app-only variant and the route.
import Fastify from 'fastify';
import * as http from 'node:http';
import type {AddressInfo} from 'node:net';
import {afterEach, describe, expect, it} from 'vitest';
import {EngineClient} from '../src/server/full/engine';
import {HealthCheck, registerHealth} from '../src/server/health';

function clock(start = 1_000) {
  let t = start;
  return {now: () => t, advance: (ms: number) => { t += ms; }};
}

describe('HealthCheck', () => {
  it('reports ok when the engine answers, with the build', async () => {
    const h = new HealthCheck({probe: async () => {}, build: () => 'abc12345-20261003T0700'});
    expect(await h.report()).toEqual({status: 200, body: {ok: true, engine: 'ok', build: 'abc12345-20261003T0700'}});
  });

  it('reports 503 and the error when the engine does not answer', async () => {
    const h = new HealthCheck({probe: async () => { throw new Error('connect ECONNREFUSED'); }, build: () => null});
    expect(await h.report()).toEqual({status: 503, body: {ok: false, engine: 'down', error: 'connect ECONNREFUSED', build: null}});
  });

  it('reports the engine off in companion-only setups, without probing', async () => {
    const h = new HealthCheck({probe: null, build: () => 'b'});
    expect(await h.report()).toEqual({status: 200, body: {ok: true, engine: 'off', build: 'b'}});
  });

  it('caches the answer for 10 s and shares one request between concurrent probes', async () => {
    const c = clock();
    let calls = 0;
    let fail = false;
    const h = new HealthCheck({probe: async () => { calls++; if (fail) throw new Error('down'); }, build: () => null, now: c.now});
    await Promise.all([h.engine(), h.engine(), h.engine()]);
    expect(calls).toBe(1);
    fail = true;
    c.advance(9_999);
    expect(await h.engine()).toEqual({engine: 'ok'});
    expect(calls).toBe(1);
    c.advance(2);
    expect(await h.engine()).toEqual({engine: 'down', error: 'down'});
    expect(calls).toBe(2);
  });

  it('passes the 2 s timeout to the probe', async () => {
    let seen = 0;
    await new HealthCheck({probe: async (ms) => { seen = ms; }, build: () => null}).engine();
    expect(seen).toBe(2000);
  });

  it('the app-only report never asks the engine', async () => {
    let calls = 0;
    const h = new HealthCheck({probe: async () => { calls++; throw new Error('down'); }, build: () => 'b'});
    expect(await h.report(true)).toEqual({status: 200, body: {ok: true, app: 'ok', build: 'b'}});
    expect(calls).toBe(0);
  });
});

// The route and the real engine probe against a stand-in engine.
const servers: http.Server[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r)))); });

async function fakeEngine(status: number): Promise<string> {
  const s = http.createServer((_req, res) => res.writeHead(status, {'Content-Type': 'text/html'}).end('<html></html>'));
  servers.push(s);
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
}

async function route(probe: HealthCheck) {
  const app = Fastify();
  registerHealth(app, probe);
  await app.ready();
  return app;
}

describe('GET /api/health', () => {
  it('200 with engine ok when the engine page answers', async () => {
    const engine = new EngineClient(await fakeEngine(200));
    const app = await route(new HealthCheck({probe: (ms) => engine.ping(ms), build: () => 'sha1'}));
    const r = await app.inject({method: 'GET', url: '/api/health'});
    expect(r.statusCode).toBe(200);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.json()).toEqual({ok: true, engine: 'ok', build: 'sha1'});
    await app.close();
  });

  it('503 with engine down when the engine errors or is unreachable; ?app=1 still 200', async () => {
    const broken = new EngineClient(await fakeEngine(500));
    const app = await route(new HealthCheck({probe: (ms) => broken.ping(ms), build: () => 'sha1'}));
    const r = await app.inject({method: 'GET', url: '/api/health'});
    expect(r.statusCode).toBe(503);
    expect(r.json()).toMatchObject({ok: false, engine: 'down', error: 'The game engine answered 500'});
    const appOnly = await app.inject({method: 'GET', url: '/api/health?app=1'});
    expect(appOnly.statusCode).toBe(200);
    expect(appOnly.json()).toEqual({ok: true, app: 'ok', build: 'sha1'});
    await app.close();

    const gone = new EngineClient('http://127.0.0.1:9');
    const app2 = await route(new HealthCheck({probe: (ms) => gone.ping(ms), build: () => null}));
    const r2 = await app2.inject({method: 'GET', url: '/api/health'});
    expect(r2.statusCode).toBe(503);
    expect(r2.json().error).toMatch(/not reachable/);
    await app2.close();
  });
});
