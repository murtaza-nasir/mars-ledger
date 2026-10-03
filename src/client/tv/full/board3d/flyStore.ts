// Fly over Mars (experimental): whether the TV's camera is being flown, by whom, and the live controls. The store
// changes only when a flight starts or ends (the hint and the options read it); the sticks and keys live in plain
// mutable objects the camera rig reads every frame, so 25 phone packets a second never re-render React.
import {create} from 'zustand';
import type {FlyInput} from '../../../../shared/fly';
import {NO_INPUT} from '../../../../shared/fly';
import type {LandReason} from './flight';

export type Pilot = {id: string; name: string; color: string};
export type FlyPhase = 'off' | 'flying' | 'landing';

type FlyStore = {
  phase: FlyPhase;
  /** the phone flying the camera; null when the TV's own keys, mouse or gamepad fly it */
  pilot: Pilot | null;
  /** why the last flight ended on its own, for the hint's last line */
  landed: {reason: LandReason | 'stop'; at: number} | null;
  /** bumps whenever the pilot or the controls in use change (the hint shows itself fully again) */
  seq: number;
};

export const useFly = create<FlyStore>(() => ({phase: 'off', pilot: null, landed: null, seq: 0}));

/** The controls, written by the TV's inputs and the phone's packets, read by the rig each frame. */
export const flyControls = {
  keys: {...NO_INPUT} as FlyInput,
  pad: {...NO_INPUT} as FlyInput,
  phone: {...NO_INPUT} as FlyInput,
  /** when the phone's latest packet arrived (performance.now) */
  phoneAt: 0,
  /** mouse-drag look, radians, consumed by the rig */
  look: {yaw: 0, pitch: 0},
  /** the wheel's speed factor */
  speed: 1,
  /** the last time anything was pressed or moved (performance.now) */
  lastInput: 0,
  /** a gamepad is connected */
  pad_connected: false,
};

export function resetControls() {
  flyControls.keys = {...NO_INPUT}; flyControls.pad = {...NO_INPUT}; flyControls.phone = {...NO_INPUT};
  flyControls.look = {yaw: 0, pitch: 0};
  flyControls.lastInput = performance.now();
}

/** Starts a flight (or hands the controls to another pilot mid-flight). */
export function startFlying(pilot: Pilot | null = null) {
  const s = useFly.getState();
  if (s.phase === 'flying' && (s.pilot?.id ?? null) === (pilot?.id ?? null)) return;
  if (s.phase !== 'flying') resetControls();
  else flyControls.phone = {...NO_INPUT};
  flyControls.lastInput = performance.now();
  useFly.setState({phase: 'flying', pilot, landed: null, seq: s.seq + 1});
}

/** Ends a flight: the camera eases back to the resting view (the rig sets 'off' once it is there). */
export function stopFlying(reason: LandReason | 'stop' = 'stop') {
  const s = useFly.getState();
  if (s.phase !== 'flying') return;
  useFly.setState({phase: 'landing', pilot: null, landed: {reason, at: Date.now()}, seq: s.seq + 1});
}

/** The rig: the camera is back at rest. */
export function landed() {
  if (useFly.getState().phase === 'landing') useFly.setState({phase: 'off'});
}

export const isFlying = () => useFly.getState().phase === 'flying';

// ---- the resting board's zoom and tilt (experimental): what the options panel shows beside its sliders ----------
export type RestInfo = {
  /** the automatic tilt, degrees */
  autoTilt: number;
  /** how far in the zoom may go at the chosen tilt (null while the sliders are off) */
  maxZoom: number | null;
  /** the zoom applied */
  zoom: number | null;
};
export const useRestInfo = create<{info: RestInfo | null}>(() => ({info: null}));
export function setRestInfo(info: RestInfo | null) {
  const cur = useRestInfo.getState().info;
  if (JSON.stringify(cur) !== JSON.stringify(info)) useRestInfo.setState({info});
}
