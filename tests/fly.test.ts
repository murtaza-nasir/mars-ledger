// Experimental camera features on the TV's 3D board: the zoom and tilt sliders' clamping, and Fly over Mars (flight
// bounds and collision, input mixing, the phone's packets and the server relay).
import {describe, expect, it} from 'vitest';
import boards from '../src/shared/data/boards.json';
import type {SpaceModel} from '../src/shared/full';
import {board3d, keepPoints, MODEL_TALL, PRISM_R, restPoints} from '../src/client/tv/full/board3d/geometry3d';
import {adjustedRest, clampTilt, clampZoom, frameXY, REST_TILT_DEG, REST_ZOOM, restView} from '../src/client/tv/full/board3d/camera3d';
import type {FrameRect} from '../src/client/tv/full/board3d/camera3d';
import {confine, deadzone, FLY, FLY_IDLE_MS, floorAt, flyFrom, keysInput, landEase, landReason, lookDir, minAltitude, mixInputs, nearFor, padInput, radiusAt, stepFlight}
  from '../src/client/tv/full/board3d/flight';
import type {FlyBounds, FlyState, Obstacle} from '../src/client/tv/full/board3d/flight';
import {isIdle, NO_INPUT, packFly, unpackFly} from '../src/shared/fly';
import type {FlyInput} from '../src/shared/fly';
import {DEFAULT_SETTINGS, parseSettings} from '../src/client/tv/settings';
import {FlyRelay} from '../src/server/fly';
import type {GameState} from '../src/shared/game';

const spaces = (boards as unknown as Record<string, SpaceModel[]>).tharsis;
const geo = board3d(spaces);
const pts = restPoints(geo);

describe('board zoom and tilt (experimental)', () => {
  it('clamps the sliders to their ranges and steps; anything else is automatic', () => {
    expect(clampZoom(2)).toBe(REST_ZOOM.max);
    expect(clampZoom(0.1)).toBe(REST_ZOOM.min);
    expect(clampZoom(1.12)).toBe(1.1);
    expect(clampZoom('x')).toBe(1);
    expect(clampZoom(Number.NaN)).toBe(1);
    expect(clampTilt(90)).toBe(REST_TILT_DEG.max);
    expect(clampTilt(5)).toBe(REST_TILT_DEG.min);
    expect(clampTilt(33)).toBe(34);
    expect(clampTilt(null)).toBeNull();
    expect(clampTilt('40')).toBeNull();
  });

  it('stores them per screen, off by default, with malformed values ignored', () => {
    const d = parseSettings(null);
    expect(d).toEqual(DEFAULT_SETTINGS);
    expect([d.boardView, d.boardZoom, d.boardTilt, d.fly, d.flyBank]).toEqual([false, null, null, false, true]);
    const s = parseSettings(JSON.stringify({boardView: true, boardZoom: 9, boardTilt: -4, fly: true, flyBank: 'no'}));
    expect([s.boardView, s.boardZoom, s.boardTilt, s.fly, s.flyBank]).toEqual([true, 1.4, 20, true, true]);
    expect(parseSettings(JSON.stringify({boardZoom: 'big', boardTilt: 'steep'}))).toMatchObject({boardZoom: null, boardTilt: null});
  });

  const aspects = [1.1, 1.6, 0.9];
  const room: FrameRect = {x0: -1.7, x1: 1.6, y0: -1.12, y1: 1.06};
  it.each(aspects)('at automatic it is exactly the automatic framing (aspect %s)', (aspect) => {
    const auto = restView(pts, aspect);
    const a = adjustedRest(pts, aspect, [], {zoom: null, tilt: null}, room);
    expect(a.view).toEqual(auto);
    expect(a.zoom).toBe(1);
  });

  it.each(aspects)('a tilt refits the board at that tilt, and the zoom moves the camera around the same centre (aspect %s)', (aspect) => {
    const t45 = adjustedRest(pts, aspect, [], {zoom: null, tilt: 46}, room).view;
    expect(t45.polar).toBeCloseTo((46 * Math.PI) / 180, 9);
    const out = adjustedRest(pts, aspect, [], {zoom: 0.8, tilt: 46}, room);
    expect(out.zoom).toBe(0.8);
    expect(out.view.dist).toBeCloseTo(t45.dist / 0.8, 9);
    expect([out.view.tx, out.view.tz]).toEqual([t45.tx, t45.tz]);
  });

  it.each([[20, 1.1], [32, 1.1], [60, 1.1], [20, 1.6], [60, 0.9]])('zooming in stops before the content leaves the screen (tilt %s, aspect %s)', (tilt, aspect) => {
    const a = adjustedRest(pts, aspect, [], {zoom: REST_ZOOM.max, tilt}, room);
    expect(a.zoom).toBeGreaterThanOrEqual(1);
    expect(a.zoom).toBeLessThanOrEqual(REST_ZOOM.max);
    for (const p of pts) {
      const q = frameXY(a.view, aspect, p);
      expect(q.y).toBeLessThanOrEqual(room.y1 + 1e-6);
      expect(q.y).toBeGreaterThanOrEqual(room.y0 - 1e-6);
      expect(q.x).toBeLessThanOrEqual(room.x1 + 1e-6);
      expect(q.x).toBeGreaterThanOrEqual(room.x0 - 1e-6);
    }
    // and it was held only because it had to be: a little more would leave the room
    if (a.zoom < REST_ZOOM.max - 1e-3) {
      const more = {...a.view, dist: a.view.dist * a.zoom / (a.zoom + 0.01)};
      expect(pts.some((p) => { const q = frameXY(more, aspect, p); return q.y > room.y1 || q.y < room.y0 || q.x > room.x1 || q.x < room.x0; })).toBe(true);
    }
  });

  it('with the hexes as what must stay on screen, zooming in goes further and keeps every hex middle in the room', () => {
    const keep = keepPoints(geo);
    const a = adjustedRest(pts, 1.13, [], {zoom: REST_ZOOM.max, tilt: 32}, room, keep);
    expect(a.zoom).toBeGreaterThan(adjustedRest(pts, 1.13, [], {zoom: REST_ZOOM.max, tilt: 32}, room).zoom);
    for (const p of keep) { const q = frameXY(a.view, 1.13, p); expect(q.y).toBeLessThanOrEqual(room.y1 + 1e-6); expect(q.y).toBeGreaterThanOrEqual(room.y0 - 1e-6); }
  });
});

// a small board for flight: a flat hex, a city, and a tall tower
const obstacles: Obstacle[] = [
  {x: 0, z: 0, r: 0.29, top: 0.07},
  {x: 0.6, z: 0, r: 0.29, top: 0.15 + 0.4},
  {x: 1.2, z: 0, r: 0.29, top: 0.12 + MODEL_TALL * PRISM_R},
];
const bounds: FlyBounds = {cx: 0, cz: 0, radius: 4, ceiling: 9, clearance: 0.12, obstacles};
const at = (x: number, y: number, z: number, yaw = 0, pitch = 0): FlyState => ({x, y, z, vx: 0, vy: 0, vz: 0, yaw, pitch, yawRate: 0, pitchRate: 0, bank: 0});
const fwd: FlyInput = {...NO_INPUT, my: 1};
const run = (s: FlyState, i: FlyInput, secs: number, opt = {}) => { for (let t = 0; t < secs; t += 1 / 60) s = stepFlight(s, i, {yaw: 0, pitch: 0}, 1 / 60, bounds, opt); return s; };

describe('Fly over Mars: flight', () => {
  it('mixes keys, gamepad and phone: sums held to -1..1, the largest boost', () => {
    const m = mixInputs({...NO_INPUT, my: 1, boost: 0.2}, {...NO_INPUT, my: 0.7, mx: -0.4}, null, {...NO_INPUT, mx: -0.9, boost: 1, lift: 0.3});
    expect(m).toEqual({mx: -1, my: 1, lx: 0, ly: 0, lift: 0.3, boost: 1});
    expect(mixInputs({...NO_INPUT, my: 1}, {...NO_INPUT, my: -1}).my).toBe(0);
  });

  it('reads keys and a gamepad', () => {
    expect(keysInput(new Set(['KeyW', 'ArrowLeft', 'KeyE', 'ShiftLeft']))).toEqual({my: 1, mx: 0, lx: -1, ly: 0, lift: 1, boost: 1});
    expect(keysInput(new Set(['KeyS', 'KeyD', 'PageDown', 'KeyT']))).toEqual({my: -1, mx: 1, lx: 0, ly: 1, lift: -1, boost: 0});
    const btn = (value: number) => ({value, pressed: value > 0.5, touched: false});
    const pad = {axes: [0.1, -1, 0.5, 0.05], buttons: Array.from({length: 17}, (_, i) => btn(i === 7 ? 0.8 : i === 6 ? 0.2 : 0))};
    const i = padInput(pad as unknown as Gamepad);
    expect(i.mx).toBe(0); // inside the dead zone
    expect(i.my).toBe(1);
    expect(i.lx).toBeCloseTo((0.5 - 0.15) / 0.85, 6);
    expect(i.ly).toBe(-0);
    expect(i.lift).toBeCloseTo(0.6, 6);
    expect(deadzone(-1)).toBe(-1);
  });

  it('starts where the camera is, looking where it looks', () => {
    const s = flyFrom([0, 10, 12], [0, -10, -12]);
    const d = lookDir(s.yaw, s.pitch), l = Math.hypot(0, 10, 12);
    expect(d[0]).toBeCloseTo(0, 9); expect(d[1]).toBeCloseTo(-10 / l, 9); expect(d[2]).toBeCloseTo(-12 / l, 9);
    const side = flyFrom([0, 1, 0], [-1, 0, 0]);
    expect(side.yaw).toBeCloseTo(Math.PI / 2, 9);
  });

  it('accelerates smoothly and glides to a stop when let go', () => {
    let s = at(0, 3, 2);
    s = stepFlight(s, fwd, {yaw: 0, pitch: 0}, 1 / 60, bounds);
    const v1 = Math.hypot(s.vx, s.vz);
    s = run(s, fwd, 1);
    const v2 = Math.hypot(s.vx, s.vz);
    expect(v1).toBeGreaterThan(0);
    expect(v2).toBeGreaterThan(v1 * 10);
    expect(s.vz).toBeLessThan(0); // forward is -z at heading 0
    const z = s.z;
    s = run(s, NO_INPUT, 0.2);
    expect(s.z).toBeLessThan(z); // still gliding
    s = run(s, NO_INPUT, 5);
    expect(Math.hypot(s.vx, s.vz)).toBe(0);
  });

  it('under reduced motion it moves only while a control is held, and never banks', () => {
    let s = run(at(0, 3, 2), {...fwd, lx: 1}, 1, {reduced: true, bank: true});
    expect(s.bank).toBe(0);
    s = stepFlight(s, NO_INPUT, {yaw: 0, pitch: 0}, 1 / 60, bounds, {reduced: true});
    expect([s.vx, s.vy, s.vz, s.yawRate]).toEqual([0, 0, 0, -0]);
  });

  it('banks gently into a turn, within the limit', () => {
    const s = run(at(0, 3, 2), {...fwd, lx: 1}, 2, {bank: true});
    expect(Math.abs(s.bank)).toBeGreaterThan(0.02);
    expect(Math.abs(s.bank)).toBeLessThanOrEqual(FLY.bankMax + 1e-9);
    expect(run(at(0, 3, 2), {...fwd, lx: 1}, 2, {bank: false}).bank).toBe(0);
  });

  it('keeps the gimbal between straight down and a little above the horizon', () => {
    expect(run(at(0, 3, 2), {...NO_INPUT, ly: -1}, 5).pitch).toBe(FLY.pitchMin);
    expect(run(at(0, 3, 2), {...NO_INPUT, ly: 1}, 5).pitch).toBe(FLY.pitchMax);
    expect(stepFlight(at(0, 3, 2), NO_INPUT, {yaw: 0, pitch: -9}, 1 / 60, bounds).pitch).toBe(FLY.pitchMin);
  });

  it('stays within the radius and under the ceiling', () => {
    let s = run(at(0, 3, 0, Math.PI / 4), {...fwd, boost: 1}, 20, {speed: 2.5});
    expect(Math.hypot(s.x, s.z)).toBeLessThanOrEqual(bounds.radius + 1e-9);
    s = run(s, {...NO_INPUT, lift: 1, boost: 1}, 30);
    expect(s.y).toBeLessThanOrEqual(bounds.ceiling);
  });

  it('the radius widens with height, so the resting view (high and well back) is inside the bounds', () => {
    const b = {...bounds, radiusTop: 11};
    expect(radiusAt(0, b)).toBe(4);
    expect(radiusAt(9, b)).toBe(11);
    // a flight starting at the resting camera stays exactly there
    const s = confine(at(0, 8.5, 10), b, 1 / 60);
    expect([s.x, s.y, s.z]).toEqual([0, 8.5, 10]);
    // going down from there, it is drawn in toward the board
    const low = run(at(0, 8.5, 10), {...NO_INPUT, lift: -1}, 30);
    expect(Math.hypot(low.x, low.z)).toBeLessThanOrEqual(radiusAt(low.y, b) + 1e-9);
  });

  it('the floor is smooth: no step at a hex edge', () => {
    let worst = 0;
    for (let x = -0.6; x < 1.8; x += 0.001) worst = Math.max(worst, Math.abs(floorAt(x + 0.001, 0, bounds) - floorAt(x, 0, bounds)));
    expect(worst).toBeLessThan(0.02);
    expect(floorAt(1.2, 0, bounds)).toBeCloseTo(obstacles[2].top, 9);
    expect(floorAt(3, 3, bounds)).toBe(0);
  });

  it('never goes through a tile: diving at full speed into the tower lifts the camera over it', () => {
    // low over the flat hex, heading +x toward the city and the tower, pushing down as hard as it can
    let s = at(-0.4, 0.2, 0, -Math.PI / 2);
    let lowest = Infinity;
    for (let t = 0; t < 4; t += 1 / 60) {
      s = stepFlight(s, {...NO_INPUT, my: 1, lift: -1, boost: 1}, {yaw: 0, pitch: 0}, 1 / 60, bounds, {speed: 2.5});
      // the room left between the camera and whatever stands under it
      lowest = Math.min(lowest, s.y - floorAt(s.x, s.z, bounds));
    }
    expect(s.x).toBeGreaterThan(1.2); // it flew on past the tower
    expect(lowest).toBeGreaterThanOrEqual(bounds.clearance * 0.5 - 1e-9);
    // and over each tile's top it never sat inside it
    for (const o of obstacles) {
      let t = at(o.x, 0, o.z);
      t = confine(t, bounds, 1 / 60);
      expect(t.y).toBeGreaterThan(o.top);
    }
  });

  it('settles on the soft floor when held down over a tall model (pushing down sinks it a little, never past half the clearance)', () => {
    const s = run(at(1.2, 2, 0), {...NO_INPUT, lift: -1}, 8);
    expect(s.y).toBeGreaterThanOrEqual(minAltitude(1.2, 0, bounds) - bounds.clearance * 0.25);
    expect(s.y).toBeLessThan(minAltitude(1.2, 0, bounds) + 0.05);
  });

  it('the near plane follows the room under the camera', () => {
    expect(nearFor(10, 0.12)).toBeCloseTo(0.06, 9);
    expect(nearFor(0.01, 0.12)).toBe(0.03);
  });

  it('hands the board back after a minute idle, for a tile placement, or for the production show', () => {
    expect(landReason({now: FLY_IDLE_MS - 1, lastInput: 0, placing: false, show: false})).toBeNull();
    expect(landReason({now: FLY_IDLE_MS, lastInput: 0, placing: false, show: false})).toBe('idle');
    expect(landReason({now: 5, lastInput: 0, placing: true, show: false})).toBe('placing');
    expect(landReason({now: 5, lastInput: 0, placing: false, show: true})).toBe('show');
    const e = landEase(0.3);
    expect(e.y).toBeGreaterThan(e.xz); // it climbs before it travels
    expect(landEase(1)).toEqual({xz: 1, y: 1, turn: 1});
  });
});

describe('Fly over Mars: the phone', () => {
  it('packs the sticks into six small integers and back', () => {
    const i: FlyInput = {mx: 0.333, my: -1.7, lx: 0, ly: 1, lift: -0.5, boost: 1};
    const p = packFly(i);
    expect(p).toEqual([33, -100, 0, 100, -50, 100]);
    expect(unpackFly(p)).toEqual({mx: 0.33, my: -1, lx: 0, ly: 1, lift: -0.5, boost: 1});
    expect(unpackFly([1, 2, 3])).toBeNull();
    expect(unpackFly('x')).toBeNull();
    expect(unpackFly([500, 0, 0, 0, 0, -20])).toEqual({mx: 1, my: 0, lx: 0, ly: 0, lift: 0, boost: 0});
    expect(isIdle(unpackFly([0, 1, 0, 0, 0, 100])!)).toBe(true);
    expect(isIdle(unpackFly([0, 30, 0, 0, 0, 0])!)).toBe(false);
  });

  const state = {players: [{id: 'p0', name: 'Ada', color: 'red'}, {id: 'p1', name: 'Vera', color: 'blue'}, {id: 'b', name: 'Bot', color: 'green', bot: 'normal'}]} as unknown as GameState;
  it('relays only the latest pilot, to TVs, and tells everyone who flies', () => {
    const r = new FlyRelay();
    const tv = {}, a = {}, b = {}, a2 = {};
    expect(r.phone(a, state, 'p0', {playerId: 'p0', op: 'start'}, 0).error).toBe('Flying is off on the TV');
    expect(r.tvReport(tv, 'ready', null)).toBe(true);
    expect(r.phone(a, state, 'p1', {playerId: 'p0', op: 'start'}, 0).error).toBeTruthy(); // not as someone else
    expect(r.phone(a, state, null, {playerId: 'b', op: 'start'}, 0).error).toBeTruthy(); // not a bot's seat
    const s1 = r.phone(a, state, 'p0', {playerId: 'p0', op: 'start'}, 0);
    expect(s1).toMatchObject({changed: true, relay: {op: 'start', from: {id: 'p0', name: 'Ada', color: 'red'}}});
    expect(r.phone(a, state, 'p0', {playerId: 'p0', op: 'input', i: [0, 100, 0, 0, 0, 0]}, 10).relay?.op).toBe('input');
    expect(r.phone(a, state, 'p0', {playerId: 'p0', op: 'input', i: 'junk'}, 10).relay).toBeUndefined();
    // Vera takes over: Ada's sticks stop reaching the TV
    expect(r.phone(b, state, 'p1', {playerId: 'p1', op: 'start'}, 20)).toMatchObject({changed: true, relay: {op: 'start'}});
    expect(r.status().pilot).toBe('p1');
    expect(r.phone(a, state, 'p0', {playerId: 'p0', op: 'input', i: [0, 100, 0, 0, 0, 0]}, 30).relay).toBeUndefined();
    expect(r.phone(a, state, 'p0', {playerId: 'p0', op: 'stop'}, 30).relay).toBeUndefined();
    // a second phone of the same seat takes over by starting, too
    r.phone(a2, state, 'p1', {playerId: 'p1', op: 'start'}, 40);
    expect(r.phone(b, state, 'p1', {playerId: 'p1', op: 'input', i: [0, 1, 0, 0, 0, 0]}, 50).relay).toBeUndefined();
    expect(r.phone(a2, state, 'p1', {playerId: 'p1', op: 'stop'}, 60)).toMatchObject({changed: true, relay: {op: 'stop'}});
    expect(r.status()).toEqual({tv: 'ready', pilot: null});
  });

  it('caps the pilot at FLY_MAX_HZ packets a second', () => {
    const r = new FlyRelay(), tv = {}, a = {};
    r.tvReport(tv, 'ready', null);
    r.phone(a, state, 'p0', {playerId: 'p0', op: 'start'}, 0);
    let passed = 0;
    for (let k = 0; k < 100; k++) if (r.phone(a, state, 'p0', {playerId: 'p0', op: 'input', i: [0, 50, 0, 0, 0, 0]}, 1000 + k * 5).relay) passed++;
    expect(passed).toBe(45);
  });

  it('ends the phone flight when the TV stops flying it, or the pilot phone or the TV goes', () => {
    const r = new FlyRelay(), tv = {}, a = {};
    r.tvReport(tv, 'ready', null);
    r.phone(a, state, 'p0', {playerId: 'p0', op: 'start'}, 0);
    r.tvReport(tv, 'flying', 'p0');
    expect(r.status()).toEqual({tv: 'flying', pilot: 'p0'});
    expect(r.tvReport(tv, 'ready', null)).toBe(true); // Esc on the TV, a minute idle, a tile placement
    expect(r.status().pilot).toBeNull();
    r.phone(a, state, 'p0', {playerId: 'p0', op: 'start'}, 0);
    expect(r.forget(a)).toBe(true);
    expect(r.status().pilot).toBeNull();
    expect(r.forget(tv)).toBe(true);
    expect(r.status()).toEqual({tv: 'off', pilot: null});
  });
});


