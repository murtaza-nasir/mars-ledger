// GET /api/health: is the app up, and does the full-game engine answer?
//   200 {ok: true, engine: 'ok', build}          the engine answered a cheap request within 2 s
//   503 {ok: false, engine: 'down', error, build} it did not (unreachable, timed out or an error status)
//   200 {ok: true, engine: 'off', build}         companion-only setups (FULL_GAME=false or no ENGINE_URL)
// The engine's answer is cached for 10 s and concurrent probes share one request, so frequent probes do not reach
// the engine more than once per window. `?app=1` skips the engine and only says the app answers (the Docker
// healthcheck uses it, so an engine outage never marks the app container unhealthy).
// Optional extra fields (mission control's health under `narrator`) ride along on the full report; they never change
// the status code, and a failure while gathering them is reported in place of the fields.
import type {FastifyInstance} from 'fastify';

export type EngineHealth = {engine: 'ok'} | {engine: 'down'; error: string} | {engine: 'off'};

export type HealthOptions = {
  /** a cheap engine request that throws when the engine is unreachable or errors; null when there is no engine */
  probe: ((timeoutMs: number) => Promise<void>) | null;
  build: () => string | null;
  /** extra fields merged into the full report (not with ?app=1); they never affect the HTTP status */
  extra?: () => Promise<Record<string, unknown>>;
  ttlMs?: number;
  timeoutMs?: number;
  now?: () => number;
};

export class HealthCheck {
  private cached: {at: number; result: EngineHealth} | null = null;
  private inflight: Promise<EngineHealth> | null = null;
  constructor(private o: HealthOptions) {}

  async engine(): Promise<EngineHealth> {
    if (!this.o.probe) return {engine: 'off'};
    const now = (this.o.now ?? Date.now)();
    if (this.cached && now - this.cached.at < (this.o.ttlMs ?? 10_000)) return this.cached.result;
    this.inflight ??= this.o.probe(this.o.timeoutMs ?? 2000)
      .then((): EngineHealth => ({engine: 'ok'}))
      .catch((e: Error): EngineHealth => ({engine: 'down', error: (e?.message || 'engine error').slice(0, 200)}))
      .then((result) => {
        this.cached = {at: (this.o.now ?? Date.now)(), result};
        this.inflight = null;
        return result;
      });
    return this.inflight;
  }

  async report(appOnly = false): Promise<{status: number; body: Record<string, unknown>}> {
    const build = this.o.build();
    if (appOnly) return {status: 200, body: {ok: true, app: 'ok', build}};
    const [e, extra] = await Promise.all([this.engine(), this.extras()]);
    return e.engine === 'down' ? {status: 503, body: {ok: false, ...e, build, ...extra}} : {status: 200, body: {ok: true, ...e, build, ...extra}};
  }

  private async extras(): Promise<Record<string, unknown>> {
    if (!this.o.extra) return {};
    try {
      return await this.o.extra();
    } catch (err) {
      return {extraError: ((err as Error)?.message || 'failed').slice(0, 200)};
    }
  }
}

export function registerHealth(app: FastifyInstance, check: HealthCheck) {
  app.get('/api/health', async (req, reply) => {
    const q = req.query as {app?: string};
    const {status, body} = await check.report(q.app === '1' || q.app === 'true');
    return reply.code(status).header('Cache-Control', 'no-store').send(body);
  });
}
