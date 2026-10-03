// The optional one-off illustration: one txt2img request to a Stable Diffusion WebUI Forge (or AUTOMATIC1111)
// API at POSTER_FORGE_URL. Off when that is not set. The instance may be shared: never change its checkpoint
// (no override_settings, no options writes), use whatever is loaded, skip when someone else is using it, and
// give up quietly.

export type ForgeConfig = {url: string; timeoutMs: number; idleTimeoutMs: number};

export function forgeConfigFromEnv(env = process.env): ForgeConfig | null {
  if (env.POSTER_UNIQUE_ENABLED === 'false' || !env.POSTER_FORGE_URL) return null;
  return {
    url: env.POSTER_FORGE_URL.replace(/\/$/, ''),
    timeoutMs: Number(env.POSTER_FORGE_TIMEOUT_MS ?? 60000),
    idleTimeoutMs: 4000,
  };
}

/** A recipe tuned for the Anima checkpoint (works with other SDXL-class checkpoints). Width/height stay near 1 MP. */
export function txt2imgBody(prompt: string, seed: number) {
  return {
    prompt,
    negative_prompt: 'text, watermark, logo, letters, signature, frame, border, people close-up, blurry, lowres',
    width: 1344,
    height: 768,
    steps: 30,
    cfg_scale: 2.5,
    distilled_cfg_scale: 7.0,
    sampler_name: 'ER SDE',
    scheduler: 'simple',
    seed,
    batch_size: 1,
    n_iter: 1,
    save_images: false,
    send_images: true,
  };
}

export type PaintResult = {ok: true; png: Buffer; ms: number} | {ok: false; reason: 'busy' | 'unreachable' | 'timeout' | 'error'; detail?: string};

export class ForgeClient {
  constructor(readonly cfg: ForgeConfig, private fetchImpl: typeof fetch = fetch) {}

  /** Idle means no job running and nothing queued; anything unexpected counts as busy. */
  async idle(): Promise<boolean | null> {
    try {
      const r = await this.fetchImpl(`${this.cfg.url}/sdapi/v1/progress?skip_current_image=true`, {signal: AbortSignal.timeout(this.cfg.idleTimeoutMs)});
      if (!r.ok) return null;
      const j = await r.json() as {progress?: number; state?: {job_count?: number; job?: string; interrupted?: boolean}};
      const jobs = j.state?.job_count ?? 0;
      return jobs <= 0 && !(j.progress && j.progress > 0);
    } catch {
      return null;
    }
  }

  async paint(prompt: string, seed: number): Promise<PaintResult> {
    const idle = await this.idle();
    if (idle === null) return {ok: false, reason: 'unreachable'};
    if (!idle) return {ok: false, reason: 'busy'};
    const t0 = Date.now();
    try {
      const r = await this.fetchImpl(`${this.cfg.url}/sdapi/v1/txt2img`, {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(txt2imgBody(prompt, seed)),
        signal: AbortSignal.timeout(this.cfg.timeoutMs),
      });
      if (!r.ok) return {ok: false, reason: 'error', detail: `HTTP ${r.status}`};
      const j = await r.json() as {images?: string[]};
      const b64 = j.images?.[0];
      if (!b64) return {ok: false, reason: 'error', detail: 'no image'};
      return {ok: true, png: Buffer.from(b64, 'base64'), ms: Date.now() - t0};
    } catch (e) {
      const name = (e as Error).name;
      return {ok: false, reason: name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'error', detail: (e as Error).message};
    }
  }
}
