// Tells the server when this TV's 3D board changes quality level (shared/tv3d.ts), so the owner can see on the server
// (its log, /api/health under `tv3d`) what a TV did without reading its options panel. Best effort, at most one report
// every few seconds (a newer one waiting replaces an older one), and only while connected.
import {sendTv3d} from '../../../net';
import type {Tv3dReport} from '../../../../shared/tv3d';

const ID_KEY = 'mars-ledger-tv-id';
let tvIdCache: string | null = null;

/** This screen's short id (made once, kept in its storage): the name the server log and /api/health use for it. */
export function tvId(): string {
  if (tvIdCache) return tvIdCache;
  try {
    const v = localStorage.getItem(ID_KEY);
    if (v && /^[a-z0-9]{4,8}$/.test(v)) return (tvIdCache = v);
  } catch { /* storage blocked */ }
  tvIdCache = Math.random().toString(36).slice(2, 8).padEnd(6, '0');
  try { localStorage.setItem(ID_KEY, tvIdCache); } catch { /* this session only */ }
  return tvIdCache;
}

export const REPORT_GAP_MS = 3000;
let lastAt = -Infinity;
let waiting: Tv3dReport | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

/** Send a report now, or once the gap since the last one has passed (the newest waiting report wins). */
export function reportTv3d(r: Omit<Tv3dReport, 'tv'>, now = Date.now()) {
  waiting = {tv: tvId(), ...r};
  if (timer) return;
  const flush = () => { timer = null; if (!waiting) return; lastAt = Date.now(); try { sendTv3d(waiting); } catch { /* best effort */ } waiting = null; };
  const wait = lastAt + REPORT_GAP_MS - now;
  if (wait <= 0) flush(); else timer = setTimeout(flush, wait);
}
