// Fly over Mars from a phone (experimental): "Fly the TV camera" in the game menu opens a full-screen controller with
// two thumbsticks (move, look) and height buttons. While this phone flies, its sticks go to the TV about 25 times a
// second. The latest phone to start flies; the others see who it is and can take over. Built for iPhone: no
// backdrop-filter or blend modes, and no scrolling, pinching or double-tap zoom while the controller is open.
import {useEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {create} from 'zustand';
import type {GameState} from '../../shared/game';
import {FLY_HZ, isIdle, packFly} from '../../shared/fly';
import type {FlyInput} from '../../shared/fly';
import {useNet} from '../net';
import {PLAYER_HEX} from './Icons';
import {rowAside, rowMain} from './rowText';
import type {Color} from '../../shared/full';

const useFlyRemote = create<{open: boolean}>(() => ({open: false}));

/** The game menu's entry. */
export function FlyRemoteItem({onDone}: {onDone: () => void}) {
  return (
    <button className="btn ghost" data-fly-remote-open="" style={{justifyContent: 'space-between', gap: 12, width: '100%'}}
      onClick={() => { onDone(); useFlyRemote.setState({open: true}); }}>
      <span style={rowMain}>Fly the TV camera</span><span className="faint" style={rowAside}>experimental</span>
    </button>
  );
}

/** Mounted beside the game menu button, so the controller outlives the menu sheet. */
export function FlyRemoteHost({state, playerId}: {state: GameState; playerId: string}) {
  const open = useFlyRemote((s) => s.open);
  if (!open || typeof document === 'undefined') return null;
  return createPortal(<Controller state={state} playerId={playerId} onClose={() => useFlyRemote.setState({open: false})} />, document.body);
}

type Vec = {x: number; y: number};

function Controller({state, playerId, onClose}: {state: GameState; playerId: string; onClose: () => void}) {
  const status = useNet((s) => s.flyStatus);
  const connected = useNet((s) => s.connected);
  const fly = useNet((s) => s.fly);
  const mine = status?.pilot === playerId;
  const pilot = status?.pilot ? state.players.find((p) => p.id === status.pilot) : undefined;
  const tvOff = !status || status.tv === 'off';
  // the sticks and buttons, read by the send loop
  const input = useRef<{move: Vec; look: Vec; lift: number; boost: boolean}>({move: {x: 0, y: 0}, look: {x: 0, y: 0}, lift: 0, boost: false});
  const [boost, setBoost] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const wasMine = useRef(false);
  const [takenBy, setTakenBy] = useState<string | null>(null);

  // someone else took over: say so
  useEffect(() => {
    if (wasMine.current && !mine) setTakenBy(pilot && pilot.id !== playerId ? pilot.name : null);
    if (mine) setTakenBy(null);
    wasMine.current = mine;
  }, [mine, pilot, playerId]);

  // no page scroll, pinch or double-tap zoom while the controller is open (iOS ignores user-scalable)
  useEffect(() => {
    const el = root.current;
    const html = document.documentElement, body = document.body;
    const prev = {h: html.style.overflow, b: body.style.overflow, t: body.style.touchAction};
    html.style.overflow = 'hidden'; body.style.overflow = 'hidden'; body.style.touchAction = 'none';
    const stop = (e: Event) => e.preventDefault();
    el?.addEventListener('touchmove', stop, {passive: false});
    document.addEventListener('gesturestart', stop);
    document.addEventListener('dblclick', stop);
    return () => {
      html.style.overflow = prev.h; body.style.overflow = prev.b; body.style.touchAction = prev.t;
      el?.removeEventListener('touchmove', stop);
      document.removeEventListener('gesturestart', stop); document.removeEventListener('dblclick', stop);
    };
  }, []);

  // while this phone flies: the sticks, FLY_HZ times a second (an idle packet only twice a second)
  useEffect(() => {
    if (!mine) return;
    let lastIdle = 0;
    const t = setInterval(() => {
      const s = input.current;
      const i: FlyInput = {mx: s.move.x, my: s.move.y, lx: s.look.x, ly: s.look.y, lift: s.lift, boost: s.boost ? 1 : 0};
      if (isIdle(i)) { if (performance.now() - lastIdle < 500) return; lastIdle = performance.now(); } else lastIdle = 0;
      fly(playerId, 'input', packFly(i));
    }, 1000 / FLY_HZ);
    return () => clearInterval(t);
  }, [mine, fly, playerId]);

  // leaving (closed, or the phone put away) ends this phone's flight
  const mineRef = useRef(mine);
  mineRef.current = mine;
  useEffect(() => {
    const hide = () => { if (document.visibilityState === 'hidden' && mineRef.current) fly(playerId, 'stop'); };
    document.addEventListener('visibilitychange', hide);
    return () => { document.removeEventListener('visibilitychange', hide); if (mineRef.current) fly(playerId, 'stop'); };
  }, [fly, playerId]);

  const start = () => { input.current = {move: {x: 0, y: 0}, look: {x: 0, y: 0}, lift: 0, boost: false}; setBoost(false); fly(playerId, 'start'); };
  const close = () => { if (mine) fly(playerId, 'stop'); onClose(); };

  const line = !connected ? 'Not connected to the table.'
    : tvOff ? 'Flying is off on the TV. Turn on Fly over Mars under Experimental in the TV options.'
    : mine ? 'You are flying the TV camera.'
    : pilot ? `${pilot.name} is flying the TV camera.`
    : takenBy ? `${takenBy} took over.` : 'Start flying to take the TV camera.';

  return (
    <div ref={root} data-fly-controller="" role="dialog" aria-label="Fly the TV camera"
      style={{position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', flexDirection: 'column', touchAction: 'none', userSelect: 'none',
        WebkitUserSelect: 'none', WebkitTouchCallout: 'none', overscrollBehavior: 'none',
        padding: 'calc(14px + env(safe-area-inset-top)) calc(16px + env(safe-area-inset-right)) calc(18px + env(safe-area-inset-bottom)) calc(16px + env(safe-area-inset-left))',
        background: 'radial-gradient(120% 70% at 50% 0%, #4A2418, #1A0C08 70%)', color: 'var(--ice)'}}>
      <div style={{display: 'flex', alignItems: 'flex-start', gap: 12}}>
        <div style={{flex: 1, minWidth: 0}}>
          <h2 style={{margin: 0, fontSize: 22, fontWeight: 750}}>Fly the TV camera</h2>
          <p data-fly-line="" className="muted" style={{margin: '4px 0 0', fontSize: 15, display: 'flex', alignItems: 'center', gap: 8}}>
            {pilot && <span aria-hidden="true" style={{width: 10, height: 10, borderRadius: 3, flex: 'none', background: PLAYER_HEX[pilot.color as Color] ?? '#fff'}} />}
            {line}
          </p>
        </div>
        <button className="btn ghost" data-fly-close="" onClick={close} style={{flex: 'none', minHeight: 44}}>{mine ? 'Stop flying' : 'Close'}</button>
      </div>

      {!mine ? (
        <div style={{flex: 1, display: 'grid', placeItems: 'center', alignContent: 'center', gap: 14, textAlign: 'center'}}>
          <button className="btn warm" data-fly-start="" disabled={tvOff || !connected} onClick={start}
            style={{minWidth: 220, minHeight: 56, fontSize: 18, opacity: tvOff || !connected ? 0.45 : 1}}>{pilot ? 'Take over' : 'Start flying'}</button>
          <p className="faint" style={{margin: 0, fontSize: 14, maxWidth: 300}}>
            The left stick moves the camera and the right stick looks around. The camera eases back to the board after a minute without input, and when someone places a tile.
          </p>
        </div>
      ) : (
        <>
          <div style={{flex: 1}} />
          <div style={{display: 'flex', justifyContent: 'center', gap: 10, marginBottom: 18}}>
            <HoldButton label="Down" onChange={(on) => { input.current.lift = on ? -1 : input.current.lift === -1 ? 0 : input.current.lift; }} />
            <button data-fly-boost="" aria-pressed={boost} onClick={() => { const b = !boost; setBoost(b); input.current.boost = b; }}
              style={{minWidth: 84, minHeight: 52, borderRadius: 14, fontSize: 16, fontWeight: 650,
                background: boost ? 'var(--ice)' : 'rgba(255,255,255,.08)', color: boost ? 'var(--dusk-1)' : 'var(--ice)'}}>Fast</button>
            <HoldButton label="Up" onChange={(on) => { input.current.lift = on ? 1 : input.current.lift === 1 ? 0 : input.current.lift; }} />
          </div>
          <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12}}>
            <Stick label="Move" onChange={(v) => { input.current.move = v; }} />
            <Stick label="Look" onChange={(v) => { input.current.look = v; }} />
          </div>
        </>
      )}
    </div>
  );
}

/** A button that is on while held (pointer capture, so a finger sliding off still lets go). */
function HoldButton({label, onChange}: {label: string; onChange: (on: boolean) => void}) {
  const [on, setOn] = useState(false);
  const set = (v: boolean) => { setOn(v); onChange(v); };
  return (
    <button data-fly-hold={label.toLowerCase()} aria-label={`Fly ${label.toLowerCase()}`}
      onPointerDown={(e) => { (e.currentTarget as Element).setPointerCapture?.(e.pointerId); set(true); }}
      onPointerUp={() => set(false)} onPointerCancel={() => set(false)} onLostPointerCapture={() => on && set(false)}
      onContextMenu={(e) => e.preventDefault()}
      style={{minWidth: 84, minHeight: 52, borderRadius: 14, fontSize: 16, fontWeight: 650, touchAction: 'none',
        background: on ? 'var(--ice)' : 'rgba(255,255,255,.08)', color: on ? 'var(--dusk-1)' : 'var(--ice)'}}>{label}</button>
  );
}

const STICK = 148, KNOB = 62;

/** A virtual thumbstick: x right and y up, each -1..1, back to the centre when let go. */
function Stick({label, onChange}: {label: string; onChange: (v: Vec) => void}) {
  const [knob, setKnob] = useState<Vec>({x: 0, y: 0});
  const pad = useRef<HTMLDivElement>(null);
  const id = useRef<number | null>(null);
  const move = (cx: number, cy: number) => {
    const r = pad.current!.getBoundingClientRect();
    const R = (r.width - KNOB) / 2;
    let dx = cx - (r.left + r.width / 2), dy = cy - (r.top + r.height / 2);
    const d = Math.hypot(dx, dy);
    if (d > R) { dx *= R / d; dy *= R / d; }
    setKnob({x: dx, y: dy});
    onChange({x: dx / R, y: -dy / R});
  };
  const end = () => { id.current = null; setKnob({x: 0, y: 0}); onChange({x: 0, y: 0}); };
  return (
    <div style={{display: 'grid', justifyItems: 'center', gap: 8}}>
      <div ref={pad} data-fly-stick={label.toLowerCase()} aria-label={`${label} stick`}
        onPointerDown={(e) => { if (id.current !== null) return; id.current = e.pointerId; (e.currentTarget as Element).setPointerCapture?.(e.pointerId); move(e.clientX, e.clientY); }}
        onPointerMove={(e) => { if (e.pointerId === id.current) move(e.clientX, e.clientY); }}
        onPointerUp={(e) => { if (e.pointerId === id.current) end(); }} onPointerCancel={(e) => { if (e.pointerId === id.current) end(); }}
        style={{position: 'relative', width: STICK, height: STICK, borderRadius: 999, touchAction: 'none', background: 'rgba(255,255,255,.06)',
          boxShadow: 'inset 0 0 0 2px rgba(255,255,255,.12)'}}>
        <div aria-hidden="true" style={{position: 'absolute', left: (STICK - KNOB) / 2, top: (STICK - KNOB) / 2, width: KNOB, height: KNOB, borderRadius: 999,
          transform: `translate(${knob.x}px, ${knob.y}px)`, background: 'var(--ice)', opacity: id.current === null ? 0.7 : 0.95,
          boxShadow: '0 4px 14px rgba(0,0,0,.45)'}} />
      </div>
      <span className="muted" style={{fontSize: 14, fontWeight: 600}}>{label}</span>
    </div>
  );
}

