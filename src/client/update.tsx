// Auto-update: a screen left open across a deploy keeps running the old bundle. The server says which build it serves (hello and every heartbeat,
// src/server/build.ts); a screen on another build reloads itself at a quiet moment.
// - TV: when nothing is playing (no production show, cinematic, recap, story, narrator caption, flicked card, board
//   dive or flight) for two seconds in a row; after three minutes of waiting it reloads at the next moment without a
//   production show or cinematic.
// - Phone: on its own only when nothing can be half-filled (no question for this seat, no sheet or dialog open, no
//   field focused, untouched for 20 s); otherwise a small "Update ready" pill to tap.
// Seat identity and TV options live in localStorage, so nothing is lost across the reload.
import {AnimatePresence, motion} from 'motion/react';
import {useEffect, useState} from 'react';
import {useNet} from './net';
import {BUILD_ID} from './perf/recorder';
import {useCinema} from './tv/cinema/queue';
import {useStage} from './tv/stage';
import {pendingBuild} from './updateRule';

const RELOADED_KEY = 'mars-ledger-reloaded-for';
const TV_QUIET_MS = 2000;
const TV_MAX_WAIT_MS = 3 * 60_000;
const PHONE_IDLE_MS = 20_000;
const PILL_AFTER_MS = 4000;

function readReloaded(): string | null {
  try { return sessionStorage.getItem(RELOADED_KEY); } catch { return null; }
}

async function reloadFor(build: string) {
  // Only once the new bundle is really what the server serves (a half-finished deploy keeps the old page).
  try {
    const r = await fetch('/build.txt', {cache: 'no-store'});
    if (r.ok && (await r.text()).trim() !== build) return;
  } catch { /* offline: try anyway; the page reload waits for the network */ }
  try { sessionStorage.setItem(RELOADED_KEY, build); } catch { /* storage blocked */ }
  location.reload();
}

/** Is the TV between moments? Reads the same signals the TV's layers wait on. */
function tvQuiet(strict: boolean): boolean {
  const net = useNet.getState();
  const p = net.production;
  if (p && Date.now() < p.localStart + p.durationMs + 1000) return false;
  const cinema = useCinema.getState();
  if (cinema.current || cinema.queue.length) return false;
  if (!strict) return true;
  const stage = useStage.getState();
  if (stage.caption || stage.moment || stage.flick || stage.story) return false;
  const b = (window as unknown as {__board3d?: {flying?: boolean; dive?: number}}).__board3d;
  if (b && (b.flying || (b.dive ?? 0) > 0.02)) return false;
  return true;
}

let lastTouch = Date.now();

function phoneSafe(): boolean {
  if (Date.now() - lastTouch < PHONE_IDLE_MS) return false;
  if (document.querySelector('[role="dialog"], [aria-modal="true"]')) return false;
  const a = document.activeElement;
  if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT')) return false;
  const view = useNet.getState().fullView;
  if (view?.role === 'player' && view.model.waitingFor) return false;
  return true;
}

export function UpdateWatcher({tv}: {tv: boolean}) {
  const server = useNet((s) => s.serverBuild);
  const build = pendingBuild(server, BUILD_ID, readReloaded());
  const [since, setSince] = useState<number | null>(null);
  const [pill, setPill] = useState(false);
  (window as unknown as {__update?: unknown}).__update = {mine: BUILD_ID, server, pending: build, since};

  useEffect(() => {
    if (!build) { setSince(null); setPill(false); return; }
    const start = Date.now();
    setSince(start);
    let quietFrom: number | null = null;
    const touch = () => { lastTouch = Date.now(); };
    if (!tv) {
      window.addEventListener('pointerdown', touch, {passive: true});
      window.addEventListener('keydown', touch);
    }
    const i = window.setInterval(() => {
      const now = Date.now();
      if (tv) {
        const quiet = tvQuiet(now - start < TV_MAX_WAIT_MS);
        quietFrom = quiet ? quietFrom ?? now : null;
        if (quietFrom !== null && now - quietFrom >= TV_QUIET_MS) { window.clearInterval(i); void reloadFor(build); }
      } else {
        if (phoneSafe()) { window.clearInterval(i); void reloadFor(build); return; }
        if (now - start >= PILL_AFTER_MS) setPill(true);
      }
    }, 500);
    return () => {
      window.clearInterval(i);
      window.removeEventListener('pointerdown', touch);
      window.removeEventListener('keydown', touch);
    };
  }, [build, tv]);

  if (tv) return null;
  return (
    <AnimatePresence>
      {build && pill && (
        <motion.button key="update" data-update-pill="" onClick={() => void reloadFor(build)}
          initial={{opacity: 0, y: -12}} animate={{opacity: 1, y: 0}} exit={{opacity: 0, y: -12}}
          style={{position: 'fixed', top: 'calc(env(safe-area-inset-top) + 8px)', left: '50%', x: '-50%', zIndex: 2147482000,
            display: 'inline-flex', alignItems: 'center', gap: 8, padding: '7px 14px', borderRadius: 999, fontSize: 14, fontWeight: 650,
            background: 'var(--ice)', color: 'var(--dusk-1)', boxShadow: '0 6px 18px rgba(0,0,0,.45)'}}>
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2v3.2h-3.2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          Update ready
        </motion.button>
      )}
    </AnimatePresence>
  );
}
