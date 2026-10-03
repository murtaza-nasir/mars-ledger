// Optional card recognition. A vision model reads the printed title and number;
// matching against the card list happens here, so the model never has to know the catalogue.
import Fuse from 'fuse.js';
import {cardsFor} from '../shared/cards';

type Provider = {name: string; url: string; model: string; key?: string; local: boolean};

export function providers(): Provider[] {
  const out: Provider[] = [];
  const order = (process.env.VISION_PROVIDERS ?? 'local,openrouter').split(',').map((s) => s.trim());
  for (const name of order) {
    // any OpenAI-compatible server with a vision model (vLLM, llama.cpp, Ollama, LM Studio); LOCAL_VLM_API_KEY if it wants one
    if (name === 'local' && process.env.LOCAL_VLM_URL && process.env.LOCAL_VLM_MODEL) {
      out.push({name, url: process.env.LOCAL_VLM_URL.replace(/\/$/, '') + '/chat/completions', model: process.env.LOCAL_VLM_MODEL,
        key: process.env.LOCAL_VLM_API_KEY || undefined, local: true});
    }
    if (name === 'openrouter' && process.env.OPENROUTER_API_KEY) {
      out.push({name, url: 'https://openrouter.ai/api/v1/chat/completions', model: process.env.OPENROUTER_VLM_MODEL ?? 'google/gemini-2.5-flash-lite',
        key: process.env.OPENROUTER_API_KEY, local: false});
    }
  }
  return out;
}

export const visionEnabled = () => process.env.VISION_ENABLED !== 'false' && providers().length > 0;

const PROMPT = 'This is a photo of a Terraforming Mars card. Reply with JSON only: {"title": string (the card name in the title band, exactly as printed), '
  + '"number": string or null (the card number printed near the cost, e.g. "024" or "R09"), "cost": integer or null}';

type Read = {title?: string; number?: string | null; cost?: number | null};

async function readCard(p: Provider, dataUrl: string, timeoutMs: number): Promise<Read> {
  const body: Record<string, unknown> = {model: p.model, temperature: 0, max_tokens: 200,
    messages: [{role: 'user', content: [{type: 'text', text: PROMPT}, {type: 'image_url', image_url: {url: dataUrl}}]}]};
  if (p.local) body.chat_template_kwargs = {enable_thinking: false};
  const r = await fetch(p.url, {method: 'POST', signal: AbortSignal.timeout(timeoutMs),
    headers: {'Content-Type': 'application/json', ...(p.key ? {Authorization: `Bearer ${p.key}`} : {})}, body: JSON.stringify(body)});
  if (!r.ok) throw new Error(`${p.name} ${r.status}`);
  const j = await r.json() as {choices?: Array<{message: {content: string}}>};
  const text = j.choices?.[0]?.message?.content ?? '';
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error(`${p.name}: no JSON`);
  return JSON.parse(m[0]) as Read;
}

export type Candidate = {name: string; number: string | null; score: number};

export function matchCard(read: Read, modules: string[], group: 'project' | 'corporation' | 'prelude' | 'any' = 'any'): Candidate[] {
  const pool = cardsFor(modules).filter((c) => group === 'any' || c.group === group);
  const byNumber = read.number ? pool.find((c) => c.number?.replace(/^#/, '').toUpperCase() === String(read.number).replace(/^#/, '').toUpperCase()) : undefined;
  const fuse = new Fuse(pool, {keys: ['name'], includeScore: true, threshold: 0.5, ignoreLocation: true});
  const hits = read.title ? fuse.search(read.title).slice(0, 4) : [];
  const out: Candidate[] = hits.map((h) => ({name: h.item.name, number: h.item.number, score: 1 - (h.score ?? 1)}));
  if (byNumber) {
    const existing = out.find((c) => c.name === byNumber.name);
    // Title and number agree: near certain. Number alone: strong but below a clean title read.
    if (existing) existing.score = Math.min(1, existing.score + 0.5);
    else out.push({name: byNumber.name, number: byNumber.number, score: 0.7});
  }
  if (read.cost !== undefined && read.cost !== null) {
    for (const c of out) if (pool.find((x) => x.name === c.name)?.cost === read.cost) c.score = Math.min(1, c.score + 0.1);
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 4);
}

export async function recognize(dataUrl: string, modules: string[], group: 'project' | 'corporation' | 'prelude' | 'any') {
  const errors: string[] = [];
  for (const p of providers()) {
    try {
      const t0 = Date.now();
      const read = await readCard(p, dataUrl, p.local ? 6000 : 15000);
      return {provider: p.name, ms: Date.now() - t0, read, candidates: matchCard(read, modules, group)};
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  throw new Error(errors.join('; ') || 'No vision model configured');
}
