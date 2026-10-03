// When the TV plays weather. A storm or mist that arrives while something covers the board (a cinematic, the
// production show, a companion moment) waits until the board is visible again, for a few seconds at most.
import {useReducedMotion} from 'motion/react';
import {useCallback, useEffect, useRef, useState} from 'react';
import {useTvSettings} from '../settings';
import {mistAllowed, stormMode} from './sky';
import {MIST_MS, STORM_MS} from './Storm';

/** A storm or mist older than this when the board is finally free is dropped, not played late. */
const MAX_WAIT_MS = 8000;
/** How long a request waits for the screen to settle (a moment or cinematic starting with the same move). */
export const SETTLE_MS = 600;

type Pending = {kind: 'storm' | 'mist'; at: number; oxygen: number};
export type WeatherNow = {storm: {at: number; mode: 'storm' | 'haze'} | null; mist: {at: number} | null};

type Debug = {storms: number; hazes: number; mists: number; skipped: string[]};
const debug: Debug = {storms: 0, hazes: 0, mists: 0, skipped: []};
(globalThis as unknown as {__weather?: Debug}).__weather = debug;

export function useWeather(covered: boolean) {
  const settings = useTvSettings();
  const reduced = !!useReducedMotion();
  const [now, setNow] = useState<WeatherNow>({storm: null, mist: null});
  const pending = useRef<Pending[]>([]);
  const gate = useRef({enabled: settings.weather, reduced, covered});
  gate.current = {enabled: settings.weather, reduced, covered};

  const play = useCallback((p: Pending) => {
    const g = gate.current;
    if (p.kind === 'storm') {
      const mode = stormMode(g);
      if (mode === 'off') { debug.skipped.push(g.enabled ? 'storm:covered' : 'storm:off'); return false; }
      if (mode === 'storm') debug.storms++; else debug.hazes++;
      setNow((n) => ({...n, storm: {at: p.at, mode}}));
      window.setTimeout(() => setNow((n) => (n.storm?.at === p.at ? {...n, storm: null} : n)), STORM_MS + 200);
    } else {
      if (!mistAllowed(g, p.oxygen)) { debug.skipped.push(!g.enabled ? 'mist:off' : g.reduced ? 'mist:reduced' : g.covered ? 'mist:covered' : 'mist:dry'); return false; }
      debug.mists++;
      setNow((n) => ({...n, mist: {at: p.at}}));
      window.setTimeout(() => setNow((n) => (n.mist?.at === p.at ? {...n, mist: null} : n)), MIST_MS + 200);
    }
    return true;
  }, []);

  /** Play what is due: anything not covered and past its settle time; drop what waited too long. */
  const flush = useCallback(() => {
    if (!pending.current.length) return;
    const now = Date.now();
    const keep: Pending[] = [];
    for (const p of pending.current) {
      if (now - p.at > MAX_WAIT_MS) { debug.skipped.push(`${p.kind}:stale`); continue; }
      if (now < p.at + SETTLE_MS || gate.current.covered) { keep.push(p); continue; }
      play({...p, at: now});
    }
    pending.current = keep;
  }, [play]);

  // The move that brings weather often also brings a moment or a cinematic, whose "covering" signal lands a
  // render later; so every request waits a beat for the screen to settle before it decides to play or wait.
  const request = useCallback((kind: 'storm' | 'mist', oxygen = 0) => {
    const g = gate.current;
    if (!g.enabled) { debug.skipped.push(`${kind}:off`); return; }
    if (kind === 'mist' && (g.reduced || oxygen < 9)) { debug.skipped.push(g.reduced ? 'mist:reduced' : 'mist:dry'); return; }
    pending.current = [...pending.current.filter((x) => x.kind !== kind), {kind, at: Date.now(), oxygen}];
    window.setTimeout(flush, SETTLE_MS + 30);
  }, [flush]);

  // The board is free again: play what waited, unless it is stale.
  useEffect(() => { if (!covered) flush(); }, [covered, flush]);

  // Turning weather off stops whatever is playing.
  useEffect(() => { if (!settings.weather) { pending.current = []; setNow({storm: null, mist: null}); } }, [settings.weather]);

  // Test hook (like window.__cam): ask for weather directly.
  (globalThis as unknown as {__weatherTest?: unknown}).__weatherTest = request;
  return {now, request, enabled: settings.weather};
}
