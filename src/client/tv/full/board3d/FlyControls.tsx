// Fly over Mars (experimental): the TV's own controls for flying the 3D board's camera (keys, mouse, a gamepad), the
// phone's sticks arriving over the websocket, the rules that hand the board back (Esc or Back, a minute without
// input, someone choosing a space for a tile, the production show), and the small hint shown while flying.
import {AnimatePresence, motion} from 'motion/react';
import {useEffect, useRef, useState} from 'react';
import {onFlyMessage, useNet} from '../../../net';
import {isIdle, NO_INPUT, unpackFly} from '../../../../shared/fly';
import {PLAYER_HEX} from '../../../ui/Icons';
import type {Color} from '../../../../shared/full';
import {tvt} from '../../settings';
import {FLY, FLY_IDLE_MS, keysInput, landReason, padInput} from './flight';
import {flyControls, isFlying, startFlying, stopFlying, useFly} from './flyStore';

const FLY_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyQ', 'KeyE', 'PageUp', 'PageDown',
  'KeyT', 'KeyG', 'ShiftLeft', 'ShiftRight']);
const STOP_KEYS = new Set(['Escape', 'GoBack', 'BrowserBack', 'Backspace']);

const optionsOpen = () => !!document.querySelector('[role="dialog"][aria-label="TV options"]');
const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

export function FlyControls({enabled, placing, reduced}: {enabled: boolean; placing: string; reduced: boolean}) {
  const phase = useFly((s) => s.phase);
  const pilot = useFly((s) => s.pilot);
  const connected = useNet((s) => s.connected);
  const on = useRef(enabled);
  on.current = enabled;

  // switched off (or the 3D board goes): the flight ends; unmounted, it is simply over
  useEffect(() => { if (!enabled) stopFlying('stop'); }, [enabled]);
  useEffect(() => () => { if (useFly.getState().phase !== 'off') useFly.setState({phase: 'off', pilot: null}); }, []);

  // what this TV can do, for the phones (again after every reconnect)
  useEffect(() => {
    useNet.getState().flyTv(!enabled ? 'off' : phase === 'flying' ? 'flying' : 'ready', phase === 'flying' ? pilot?.id ?? null : null);
  }, [enabled, phase, pilot, connected]);
  useEffect(() => () => useNet.getState().flyTv('off', null), []);

  // the phone's messages
  useEffect(() => {
    onFlyMessage((m) => {
      const cur = useFly.getState().pilot;
      if (m.op === 'start') { if (on.current) startFlying(m.from); return; }
      if (!cur || cur.id !== m.from.id) return;
      if (m.op === 'stop') { stopFlying('stop'); return; }
      const i = unpackFly(m.i);
      if (!i) return;
      flyControls.phone = i;
      flyControls.phoneAt = performance.now();
      if (!isIdle(i)) flyControls.lastInput = performance.now();
    });
    return () => onFlyMessage(null);
  }, []);

  // keys: F starts and stops; while flying the flight keys are the camera's (nothing else on the page sees them)
  useEffect(() => {
    if (!enabled) return;
    const held = new Set<string>();
    const sync = () => { flyControls.keys = keysInput(held); flyControls.lastInput = performance.now(); };
    const down = (e: KeyboardEvent) => {
      if (typing(e.target) || optionsOpen() || e.ctrlKey || e.metaKey || e.altKey) return;
      if (!isFlying()) {
        if (e.code === 'KeyF' && !e.repeat) { startFlying(null); e.preventDefault(); }
        return;
      }
      if (STOP_KEYS.has(e.key) || e.code === 'KeyF') { stopFlying('stop'); e.preventDefault(); e.stopImmediatePropagation(); return; }
      if (!FLY_KEYS.has(e.code)) return;
      held.add(e.code); sync();
      e.preventDefault(); e.stopImmediatePropagation();
    };
    const up = (e: KeyboardEvent) => { if (held.delete(e.code)) { sync(); e.preventDefault(); e.stopImmediatePropagation(); } };
    const blur = () => { held.clear(); flyControls.keys = {...NO_INPUT}; };
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', down, true); window.removeEventListener('keyup', up, true); window.removeEventListener('blur', blur); blur(); };
  }, [enabled]);

  // the mouse: drag to look, the wheel sets the speed
  const [speedShown, setSpeedShown] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let drag: {x: number; y: number; id: number} | null = null;
    const inUi = (t: EventTarget | null) => t instanceof Element && !!t.closest('[data-tv-options], [data-radio], [data-sound-toggle], button, a');
    const pd = (e: PointerEvent) => { if (isFlying() && e.button === 0 && !inUi(e.target)) drag = {x: e.clientX, y: e.clientY, id: e.pointerId}; };
    const pm = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id || !isFlying()) return;
      const h = window.innerHeight || 1;
      flyControls.look.yaw -= ((e.clientX - drag.x) / h) * 1.8;
      flyControls.look.pitch -= ((e.clientY - drag.y) / h) * 1.4;
      drag = {...drag, x: e.clientX, y: e.clientY};
      flyControls.lastInput = performance.now();
    };
    const pu = (e: PointerEvent) => { if (drag && e.pointerId === drag.id) drag = null; };
    const wheel = (e: WheelEvent) => {
      if (!isFlying() || inUi(e.target)) return;
      e.preventDefault();
      const [lo, hi] = FLY.speedRange;
      flyControls.speed = Math.max(lo, Math.min(hi, flyControls.speed * Math.exp(-e.deltaY * 0.0012)));
      flyControls.lastInput = performance.now();
      setSpeedShown(performance.now());
    };
    window.addEventListener('pointerdown', pd);
    window.addEventListener('pointermove', pm);
    window.addEventListener('pointerup', pu);
    window.addEventListener('pointercancel', pu);
    window.addEventListener('wheel', wheel, {passive: false});
    return () => {
      window.removeEventListener('pointerdown', pd); window.removeEventListener('pointermove', pm); window.removeEventListener('pointerup', pu);
      window.removeEventListener('pointercancel', pu); window.removeEventListener('wheel', wheel);
    };
  }, [enabled]);

  // a gamepad: Start starts and stops, B stops; polled once a frame while the feature is on
  const [padSeen, setPadSeen] = useState(false);
  useEffect(() => {
    if (!enabled || typeof navigator === 'undefined' || !navigator.getGamepads) return;
    let raf = 0, prev = {start: false, back: false}, seen = false;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      let pad: Gamepad | null = null;
      try { for (const p of navigator.getGamepads()) if (p && p.connected) { pad = p; break; } } catch { /* not allowed here */ }
      if (!!pad !== seen) { seen = !!pad; flyControls.pad_connected = seen; setPadSeen(seen); }
      if (!pad) { flyControls.pad = {...NO_INPUT}; return; }
      const start = !!pad.buttons[9]?.pressed, back = !!pad.buttons[1]?.pressed;
      if (start && !prev.start && !optionsOpen()) { if (isFlying()) stopFlying('stop'); else startFlying(null); }
      if (back && !prev.back && isFlying()) stopFlying('stop');
      prev = {start, back};
      if (!isFlying()) { flyControls.pad = {...NO_INPUT}; return; }
      const i = padInput(pad);
      flyControls.pad = i;
      if (!isIdle(i)) flyControls.lastInput = performance.now();
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [enabled]);

  // the board is handed back: someone starts choosing a space for a tile (the board must be readable for it)
  const lastPlacing = useRef(placing);
  useEffect(() => {
    if (placing && placing !== lastPlacing.current && isFlying()) stopFlying('placing');
    lastPlacing.current = placing;
  }, [placing]);
  // ... a minute without input, or the production show starting
  const production = useNet((s) => s.production);
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    if (phase !== 'flying') return;
    const t = setInterval(() => {
      const show = !!production && Date.now() >= production.localStart - 100 && Date.now() < production.localStart + production.durationMs;
      const r = landReason({now: performance.now(), lastInput: flyControls.lastInput, placing: false, show});
      if (r) stopFlying(r);
      setNow(performance.now());
    }, 250);
    return () => clearInterval(t);
  }, [phase, production]);

  return <FlyHint phase={phase} pilot={pilot} pad={padSeen} reduced={reduced} now={now} speedAt={speedShown} />;
}

/** The hint while flying: who flies, the controls in use and how to stop; it dims after a few seconds. */
function FlyHint({phase, pilot, pad, reduced, now, speedAt}: {phase: string; pilot: ReturnType<typeof useFly.getState>['pilot']; pad: boolean; reduced: boolean; now: number; speedAt: number}) {
  const seq = useFly((s) => s.seq);
  const landedWhy = useFly((s) => s.landed);
  const [bright, setBright] = useState(true);
  useEffect(() => { setBright(true); const t = setTimeout(() => setBright(false), 6000); return () => clearTimeout(t); }, [seq, pad]);
  const idleLeft = Math.ceil((FLY_IDLE_MS - (now - flyControls.lastInput)) / 1000);
  const speedNote = performance.now() - speedAt < 1600 ? `Speed ${flyControls.speed.toFixed(1)}×` : null;
  const flying = phase === 'flying';
  const back = !flying && landedWhy && Date.now() - landedWhy.at < 3000 && (landedWhy.reason === 'placing' || landedWhy.reason === 'idle')
    ? (landedWhy.reason === 'placing' ? 'Back to the board: someone is placing a tile' : 'Back to the board after a minute without input') : null;
  const lines: string[] = [];
  if (flying) {
    if (pilot) lines.push('Stop on the phone, or press Esc');
    else {
      lines.push('WASD or arrows to fly · Q and E for height · Shift for speed · drag to look · Esc to stop');
      if (pad) lines.push('Gamepad: sticks fly and look, triggers set height, B stops');
    }
    if (idleLeft <= 10) lines.push(`Back to the board in ${Math.max(0, idleLeft)} s`);
    else if (speedNote) lines.push(speedNote);
  }
  const show = flying || !!back;
  return (
    <div style={{position: 'absolute', left: 0, right: 0, bottom: '1.2%', display: 'flex', justifyContent: 'center', zIndex: 5, pointerEvents: 'none'}}>
    <AnimatePresence>
      {show && (
        <motion.div key="fly-hint" data-fly-hint="" role="status" aria-live="polite"
          initial={{opacity: 0, y: reduced ? 0 : 8}} animate={{opacity: bright || idleLeft <= 10 || back ? 0.96 : 0.6, y: 0}} exit={{opacity: 0}}
          transition={{duration: 0.4}}
          style={{maxWidth: '96%',
            padding: '0.5vh 1.1vw 0.6vh', borderRadius: '1vw', background: 'rgba(12,5,3,.88)', boxShadow: '0 0 0 1px rgba(255,255,255,.08)',
            color: 'var(--ice)', textAlign: 'center', fontSize: tvt(0.9), lineHeight: 1.3}}>
          <div style={{fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '0.5vw', whiteSpace: 'nowrap'}}>
            {flying && pilot && <span style={{width: '0.75vw', height: '0.75vw', minWidth: 10, minHeight: 10, borderRadius: 3, background: PLAYER_HEX[pilot.color as Color] ?? '#fff'}} />}
            {back ?? (pilot ? `${pilot.name}'s phone is flying the camera` : 'Flying over Mars')}
          </div>
          {lines.map((l) => <div key={l} className="faint" style={{whiteSpace: 'nowrap', fontSize: tvt(0.8)}}>{l}</div>)}
        </motion.div>
      )}
    </AnimatePresence>
    </div>
  );
}
